from __future__ import annotations

import csv, glob, math, os, statistics
from collections import Counter, defaultdict
from datetime import datetime, timezone

ROOT = r"C:\Users\drkkr\Downloads\NIFTY ALL1783"
REPORT = os.path.join(ROOT, "donchian_backtest_report.md")
TRADES_OUT = os.path.join(ROOT, "donchian_backtest_trades.csv")
ATR_N = 14; LEFT = 2; RIGHT = 2
MIN_PROM = .25; MIN_REC = .5
PRICE_BAND = datetime(2025,4,15,tzinfo=timezone.utc).timestamp()*1000

def clamp(x, lo=0.0, hi=1.0): return max(lo, min(hi, x))
def ts(date): return int(datetime.strptime(date, "%d-%b-%Y").replace(tzinfo=timezone.utc).timestamp()*1000)
def tr(c, prev=None): return c[2]-c[3] if prev is None else max(c[2]-c[3], abs(c[2]-prev), abs(c[3]-prev))
def atrs(cs):
    out=[None]*len(cs)
    if len(cs)<ATR_N: return out
    r=[tr(c, None if i==0 else cs[i-1][4]) for i,c in enumerate(cs)]
    a=sum(r[:ATR_N])/ATR_N; out[ATR_N-1]=a
    for i in range(ATR_N,len(cs)):
        a=(a*(ATR_N-1)+r[i])/ATR_N; out[i]=a
    return out
def tick_size(cs, i):
    if cs[i][0] < PRICE_BAND: return .05
    d=datetime.fromtimestamp(cs[i][0]/1000, timezone.utc)
    cutoff=(d.year,d.month)
    ref=None
    for c in reversed(cs[:i]):
        rd=datetime.fromtimestamp(c[0]/1000, timezone.utc)
        if (rd.year,rd.month) != cutoff: ref=c[4]; break
    if ref is None: return None
    if ref < 250: return .01
    if ref <= 1000: return .05
    if ref <= 5000: return .1
    if ref <= 10000: return .5
    if ref <= 20000: return 1.0
    return 5.0
def lower(cs, end, n): return min(c[3] for c in cs[end-n+1:end+1])
def rollover(cs, i, n, tick):
    if i-n<0: return None
    cur=lower(cs,i,n); prev=lower(cs,i-1,n)
    return (cur>prev and round(cs[i][3]/tick)==round(cur/tick),cur,prev)
def pivots(cs, atr):
    out=[]; first=max(LEFT,ATR_N-1)
    for p in range(first,len(cs)-RIGHT):
        if not all(cs[p][3] < cs[j][3] for j in list(range(p-LEFT,p))+list(range(p+1,p+1+RIGHT))): continue
        if atr[p] is None or atr[p]<=0: continue
        neigh=min([cs[j][3] for j in list(range(p-LEFT,p))+list(range(p+1,p+1+RIGHT))])
        rec=max(cs[j][2] for j in range(p+1,p+1+RIGHT))
        prom=(neigh-cs[p][3])/atr[p]; recovery=(rec-cs[p][3])/atr[p]
        if prom<MIN_PROM or recovery<MIN_REC: continue
        out.append((p,prom,recovery))
    return out
def structural(cs,i,p,prom,recovery,atr):
    comp={"prominence":clamp(prom/2),"recovery":clamp(recovery/3),"recency":clamp(1-(i-p)/200)}
    pa=atr[p]; zone=cs[p][3]+.25*pa; count=0; was=False
    for j in range(p+RIGHT+1,i):
        ok=cs[j][3]>=cs[p][3] and cs[j][3]<=zone and cs[j][4]>cs[p][3]
        if ok and not was: count+=1
        was=ok
    comp["retests"]=clamp(count/3)
    base=[c[5] for c in cs[max(0,p-20):p] if c[5]>0]
    comp["relativeVolume"]=clamp((cs[p][5]/statistics.median(base) if base and statistics.median(base)>0 else 0)/2)
    comp["higherTimeframeAgreement"]=0
    score=.3*comp["prominence"]+.25*comp["recovery"]+.15*comp["recency"]+.15*comp["retests"]+.1*comp["relativeVolume"]
    return score
def levels(cs,i,p,tick,atr):
    entry=math.ceil((cs[i][4]/tick)-1e-12)*tick
    stop=math.floor((cs[i][3]-.1*atr[i])/tick+1e-12)*tick
    risk_ticks=round(entry/tick)-round(stop/tick)
    if risk_ticks<=0: return None
    target1=entry+risk_ticks*tick; target2=entry+2*risk_ticks*tick
    first=max(p+1,LEFT); last=i-1-RIGHT; rh=None
    for j in range(first,last+1):
        if all(cs[j][2]>cs[k][2] for k in range(j-LEFT,j+RIGHT+1) if k!=j): rh=cs[j][2] if rh is None else max(rh,cs[j][2])
    if rh is None or math.floor(rh/tick+1e-12)*tick < target1: return None
    return entry,stop,target1,target2,risk_ticks*tick
def evaluate_signal(cs,i,atr,all_pivots):
    if i < ATR_N+RIGHT or cs[i][4] <= cs[i][3]: return None
    tick=tick_size(cs,i)
    if tick is None: return None
    selected=None
    for p,prom,rec in all_pivots:
        if p + RIGHT >= i: continue
        n=i-p; ro=rollover(cs,i,n,tick)
        if not ro or not ro[0]: continue
        score=structural(cs,i,p,prom,rec,atr)
        candidate=(score,p,n,ro[1],ro[2],prom,rec)
        if selected is None or candidate[:2] > selected[:2]: selected=candidate
    if selected is None: return None
    score,p,n,cur,prev,prom,rec=selected; lv=levels(cs,i,p,tick,atr)
    if lv is None or i+1>=len(cs): return None
    return {"signal_i":i,"signal_date":datetime.fromtimestamp(cs[i][0]/1000,timezone.utc).date().isoformat(),"period":n,"entry_ref":lv[0],"stop":lv[1],"target1":lv[2],"target2":lv[3],"risk":lv[4],"score":score,"next_open":cs[i+1][1]}
def simulate(cs, sig, horizon=60):
    i=sig["signal_i"]; entry=cs[i+1][1]
    # Do not manufacture a fill when the next-session gap has already crossed
    # the protective stop or the first objective. The live UI explicitly warns
    # users to skip adverse reward/risk gaps.
    if entry <= sig["stop"] or entry >= sig["target1"]:
        sig.update({"actual_entry":entry,"outcome":"GAP_SKIP","exit_date":"","r_multiple":0.0,"mfe_R":0.0,"mae_R":0.0,"hit_5R":False})
        return sig
    risk=entry-sig["stop"]
    mae=min(0.0, min((cs[j][3]-entry)/risk for j in range(i+1,min(len(cs),i+1+horizon))))
    mfe=max(0.0, max((cs[j][2]-entry)/risk for j in range(i+1,min(len(cs),i+1+horizon))))
    outcome="OPEN"; exit_i=None; r_end=(cs[min(len(cs)-1,i+horizon)][4]-entry)/risk
    for j in range(i+1,min(len(cs),i+1+horizon)):
        o,h,l=cs[j][1],cs[j][2],cs[j][3]
        if o <= sig["stop"]: outcome="STOP"; exit_i=j; r=-1.0; break
        if o >= sig["target2"]: outcome="TARGET2"; exit_i=j; r=(sig["target2"]-entry)/risk; break
        if o >= sig["target1"]: outcome="TARGET1"; exit_i=j; r=(sig["target1"]-entry)/risk; break
        if l <= sig["stop"]: outcome="STOP"; exit_i=j; r=(sig["stop"]-entry)/risk; break
        if h >= sig["target2"]: outcome="TARGET2"; exit_i=j; r=(sig["target2"]-entry)/risk; break
        if h >= sig["target1"]: outcome="TARGET1"; exit_i=j; r=(sig["target1"]-entry)/risk; break
    else: r=r_end
    sig.update({"actual_entry":entry,"outcome":outcome,"exit_date":datetime.fromtimestamp(cs[exit_i][0]/1000,timezone.utc).date().isoformat() if exit_i is not None else "","r_multiple":r,"mfe_R":mfe,"mae_R":mae,"hit_5R":mfe>=5})
    return sig
def main():
    files=glob.glob(os.path.join(ROOT,"*_NS_OHLCV.csv")); quality=Counter(); alltrades=[]; symbol_stats=[]
    for path in files:
        sym=os.path.basename(path).replace("_NS_OHLCV.csv",""); cs=[]; seen=set(); bad=0
        with open(path,newline="",encoding="utf-8-sig") as f:
            for row in csv.DictReader(f):
                try:
                    d=row["DATE"]; t=ts(d); vals=[float(row[k]) for k in ("OPEN","HIGH","LOW","CLOSE","VOLUME")]
                    if t in seen or not(vals[2]<=vals[1] and vals[2]<=vals[0] and vals[2]<=vals[3] and all(math.isfinite(x) for x in vals)): bad+=1; continue
                    seen.add(t); cs.append((t,*vals))
                except Exception: bad+=1
        cs.sort(); quality["files"]+=1; quality["bad_rows"]+=bad; quality["rows"]+=len(cs)
        atr=atrs(cs); all_pivots=pivots(cs,atr); sigs=[]
        for i in range(len(cs)-1):
            s=evaluate_signal(cs,i,atr,all_pivots)
            if s: sigs.append(s)
        accepted=[]; next_available=-1
        for s in sigs:
            if s["signal_i"] < next_available: continue
            trd=simulate(cs,s); accepted.append(trd); next_available=s["signal_i"]+1+60 if trd["outcome"]=="OPEN" else trd["signal_i"]+1+(trd["exit_date"] and next((j for j,c in enumerate(cs) if datetime.fromtimestamp(c[0]/1000,timezone.utc).date().isoformat()==trd["exit_date"]),1))
        for s in accepted: s["symbol"]=sym; alltrades.append(s)
        if accepted: symbol_stats.append((sym,len(accepted),sum(x["outcome"] in ("TARGET1","TARGET2") for x in accepted)/len(accepted)))
    wins=[x for x in alltrades if x["outcome"] in ("TARGET1","TARGET2")]; stops=[x for x in alltrades if x["outcome"]=="STOP"]; closed=wins+stops
    gross_profit=sum(max(0,x["r_multiple"]) for x in closed); gross_loss=-sum(min(0,x["r_multiple"]) for x in closed)
    pf=gross_profit/gross_loss if gross_loss else math.inf
    wr=len(wins)/len(closed) if closed else 0
    byyear=defaultdict(list)
    for x in alltrades: byyear[x["signal_date"][:4]].append(x)
    with open(TRADES_OUT,"w",newline="",encoding="utf-8") as f:
        fields=["symbol","signal_date","period","entry_ref","actual_entry","stop","target1","target2","outcome","exit_date","r_multiple","mfe_R","mae_R","hit_5R","score"]
        w=csv.DictWriter(f,fieldnames=fields); w.writeheader(); w.writerows({k:x.get(k,"") for k in fields} for x in alltrades)
    lines=["# Donchian Reversal Screener — NIFTY archive backtest", "", f"Archive: `{ROOT}`", f"Files: {quality['files']:,}; valid rows: {quality['rows']:,}; rejected rows: {quality['bad_rows']:,}", "Daily OHLCV only; dates interpreted as NSE sessions. Signals use completed candle t, next session open execution, fixed 60-session maximum holding window, one trade at a time per symbol, and conservative stop-first ambiguity.", "", "## Headline results", "", f"- Eligible executed trades: **{len(alltrades):,}**", f"- Closed trades: **{len(closed):,}**; open/uncensored at 60 sessions: **{len(alltrades)-len(closed):,}**", f"- Win rate (target 1 or target 2 among closed): **{wr:.1%}**", f"- Profit factor (gross positive R / gross negative R): **{pf:.2f}**", f"- Net realized R: **{sum(x['r_multiple'] for x in closed):.2f}**", f"- Stop-hit rate among closed: **{len(stops)/len(closed):.1%}**", f"- Target 1 hit rate among all trades: **{sum(x['outcome']=='TARGET1' for x in alltrades)/len(alltrades):.1%}**", f"- Target 2 hit rate among all trades: **{sum(x['outcome']=='TARGET2' for x in alltrades)/len(alltrades):.1%}**", f"- 5R MFE rate: **{sum(x['hit_5R'] for x in alltrades)/len(alltrades):.1%}**", f"- Mean / median MFE: **{statistics.mean(x['mfe_R'] for x in alltrades):.2f}R / {statistics.median(x['mfe_R'] for x in alltrades):.2f}R**", f"- Mean / median MAE: **{statistics.mean(x['mae_R'] for x in alltrades):.2f}R / {statistics.median(x['mae_R'] for x in alltrades):.2f}R**", "", "## Yearly breakdown", "", "| Year | Trades | Closed | Win rate | PF | Net R | Stop rate | 5R MFE |", "|---|---:|---:|---:|---:|---:|---:|---:|"]
    for y,xs in sorted(byyear.items()):
        cl=[x for x in xs if x["outcome"] in ("TARGET1","TARGET2","STOP")]; ww=[x for x in cl if x["outcome"] in ("TARGET1","TARGET2")]; gp=sum(max(0,x["r_multiple"]) for x in cl); gl=-sum(min(0,x["r_multiple"]) for x in cl); lines.append(f"| {y} | {len(xs)} | {len(cl)} | {(len(ww)/len(cl) if cl else 0):.1%} | {(gp/gl if gl else 0):.2f} | {sum(x['r_multiple'] for x in cl):.2f} | {(sum(x['outcome']=='STOP' for x in cl)/len(cl) if cl else 0):.1%} | {sum(x['hit_5R'] for x in xs)/len(xs):.1%} |")
    lines += ["", "## Interpretation and limitations", "", "This is a rules backtest, not proof of future profitability. It uses the archive's raw OHLC, not Yahoo re-fetches, and does not model brokerage, STT, GST, slippage, partial fills, liquidity, corporate actions, or survivorship bias. The archive appears to contain current/available symbols, so delisted names may be absent. Daily files cannot validate the screener's 5-minute, 15-minute, hourly, weekly, or monthly behavior.", "", "A BUY is counted only when the screener's causal pivot/period selector, Donchian rollover, close-above-low gate, and trade-level feasibility all pass. Period selection sees only bars closed before the signal. The report deliberately separates target-1 wins, target-2 wins, 5R maximum-favorable-excursion, and unresolved 60-session trades.", "", "Trade-level detail: `donchian_backtest_trades.csv`"]
    open(REPORT,"w",encoding="utf-8").write("\n".join(lines)+"\n")
    print(REPORT); print(TRADES_OUT); print("trades",len(alltrades),"closed",len(closed),"winrate",wr,"PF",pf)
if __name__=="__main__": main()
