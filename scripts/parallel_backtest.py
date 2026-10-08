from __future__ import annotations
import csv, glob, os, statistics
from collections import Counter, defaultdict
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timezone
import backtest_nifty_archive as bt

ROOT=bt.ROOT
def worker(path):
    sym=os.path.basename(path).replace("_NS_OHLCV.csv",""); by_time={}; dup=0; bad=0
    with open(path,newline="",encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            try:
                t=bt.ts(row["DATE"]); vals=[float(row[k]) for k in ("OPEN","HIGH","LOW","CLOSE","VOLUME")]
                if not(vals[2]<=vals[1] and vals[2]<=vals[0] and vals[2]<=vals[3] and all(map(__import__('math').isfinite,vals))): bad+=1; continue
                if t in by_time: dup+=1
                by_time[t]=(t,*vals)
            except Exception: bad+=1
    cs=sorted(by_time.values()); atr=bt.atrs(cs); aps=bt.pivots(cs,atr); sigs=[]
    for i in range(len(cs)-1):
        s=bt.evaluate_signal(cs,i,atr,aps)
        if s: sigs.append(s)
    accepted=[]; next_available=-1
    for s in sigs:
        if s["signal_i"] < next_available: continue
        tr=bt.simulate(cs,s); accepted.append(tr)
        if tr["outcome"]=="OPEN": next_available=tr["signal_i"]+61
        else:
            ex=next((j for j,c in enumerate(cs) if datetime.fromtimestamp(c[0]/1000,timezone.utc).date().isoformat()==tr["exit_date"]), tr["signal_i"]+1)
            next_available=ex+1
    for s in accepted: s["symbol"]=sym
    return sym,accepted,bad,dup,len(cs)

def main():
    files=glob.glob(os.path.join(ROOT,"*_NS_OHLCV.csv")); results=[]
    with ProcessPoolExecutor(max_workers=max(2,(os.cpu_count() or 4)-1)) as ex:
        for n,r in enumerate(ex.map(worker,files),1):
            results.append(r)
            if n%100==0: print(f"processed {n}/{len(files)}",flush=True)
    trades=[t for _,xs,_,_,_ in results for t in xs]; skipped=[t for t in trades if t["outcome"]=="GAP_SKIP"]; closed=[t for t in trades if t["outcome"] in ("TARGET1","TARGET2","STOP")]; wins=[t for t in closed if t["outcome"] in ("TARGET1","TARGET2")]; stops=[t for t in closed if t["outcome"]=="STOP"]
    gp=sum(max(0,t["r_multiple"]) for t in closed); gl=-sum(min(0,t["r_multiple"]) for t in closed); pf=gp/gl if gl else float("inf")
    wr=len(wins)/len(closed) if closed else 0
    byyear=defaultdict(list)
    for t in trades: byyear[t["signal_date"][:4]].append(t)
    report=os.path.join(ROOT,"donchian_backtest_report.md"); detail=os.path.join(ROOT,"donchian_backtest_trades.csv")
    with open(detail,"w",newline="",encoding="utf-8") as f:
        fields=["symbol","signal_date","period","entry_ref","actual_entry","stop","target1","target2","outcome","exit_date","r_multiple","mfe_R","mae_R","hit_5R","score"]; w=csv.DictWriter(f,fieldnames=fields); w.writeheader(); w.writerows({k:t.get(k,"") for k in fields} for t in trades)
    tradable=len(trades)-len(skipped); lines=["# Donchian Reversal Screener — NIFTY archive backtest","",f"Archive: `{ROOT}`",f"Files: {len(files):,}; valid rows after last-valid deduplication: **{sum(r[4] for r in results):,}**; malformed rows rejected: **{sum(r[2] for r in results):,}**; duplicate rows replaced by the last valid row: **{sum(r[3] for r in results):,}**","Daily OHLCV only; completed candle signal, next-session-open execution, fixed 60-session maximum holding window, one open trade per symbol, conservative stop-first ambiguity.","","## Headline results","",f"- Candidate signals with a next session: **{len(trades):,}**",f"- Adverse/unfillable opening gaps skipped: **{len(skipped):,}** ({len(skipped)/len(trades):.1%})",f"- Tradable trades: **{tradable:,}**; closed trades: **{len(closed):,}**; unresolved at 60 sessions: **{tradable-len(closed):,}**",f"- Win rate (target 1 or target 2 among closed): **{wr:.1%}**",f"- Profit factor (gross positive R / gross negative R): **{pf:.2f}**",f"- Net realized R: **{sum(t['r_multiple'] for t in closed):.2f}**",f"- Stop-hit rate among closed: **{len(stops)/len(closed):.1%}",f"- Target 1 hit rate among tradable trades: **{sum(t['outcome']=='TARGET1' for t in trades)/tradable:.1%}**",f"- Target 2 hit rate among tradable trades: **{sum(t['outcome']=='TARGET2' for t in trades)/tradable:.1%}**",f"- 5R MFE rate: **{sum(t['hit_5R'] for t in trades)/tradable:.1%}**",f"- Mean / median MFE: **{statistics.mean(t['mfe_R'] for t in trades if t['outcome']!='GAP_SKIP'):.2f}R / {statistics.median(t['mfe_R'] for t in trades if t['outcome']!='GAP_SKIP'):.2f}R**",f"- Mean / median MAE: **{statistics.mean(t['mae_R'] for t in trades if t['outcome']!='GAP_SKIP'):.2f}R / {statistics.median(t['mae_R'] for t in trades if t['outcome']!='GAP_SKIP'):.2f}R**","","## Yearly breakdown","","| Year | Trades | Skipped | Closed | Win rate | PF | Net R | Stop rate | 5R MFE |","|---|---:|---:|---:|---:|---:|---:|---:|---:|"]
    for y,xs in sorted(byyear.items()):
        cl=[t for t in xs if t["outcome"] in ("TARGET1","TARGET2","STOP")]; ww=[t for t in cl if t["outcome"] in ("TARGET1","TARGET2")]; gp2=sum(max(0,t["r_multiple"]) for t in cl); gl2=-sum(min(0,t["r_multiple"]) for t in cl); trad_y=[t for t in xs if t["outcome"]!="GAP_SKIP"]; lines.append(f"| {y} | {len(xs)} | {sum(t['outcome']=='GAP_SKIP' for t in xs)} | {len(cl)} | {(len(ww)/len(cl) if cl else 0):.1%} | {(gp2/gl2 if gl2 else 0):.2f} | {sum(t['r_multiple'] for t in cl):.2f} | {(sum(t['outcome']=='STOP' for t in cl)/len(cl) if cl else 0):.1%} | {sum(t['hit_5R'] for t in trad_y)/(len(trad_y) or 1):.1%} |")
    lines += ["","## Definitions and limitations","","Win = target 1 or target 2 reached before the stop. Profit factor is gross realized positive R divided by gross realized negative R; it excludes unresolved trades. MFE/MAE are maximum favorable/adverse excursion in R over the 60-session window. 5R MFE is the share whose high reached at least five initial risks. Results use raw OHLC and the screener's causal pivot/period selector; no future candles are used for signal formation.","","This is not a guarantee of future profitability. No slippage, brokerage, taxes, partial fills, liquidity limits, corporate-action reconstruction, or delisted-symbol survivorship correction is applied. Daily data cannot validate intraday or monthly behavior.","","Trade-level detail: `donchian_backtest_trades.csv`"]
    open(report,"w",encoding="utf-8").write("\n".join(lines)+"\n"); print(report); print(detail); print("trades",len(trades),"closed",len(closed),"winrate",wr,"PF",pf)
if __name__=="__main__": main()
