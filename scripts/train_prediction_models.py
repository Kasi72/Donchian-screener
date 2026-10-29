"""Research-only chronological joint-outcome validation. Never promotes a live model.

Usage: python scripts/train_prediction_models.py dataset-directory new-report.json
Dependencies: numpy, pandas, scikit-learn >= 1.6.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.frozen import FrozenEstimator
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler, SplineTransformer

CLASSES = ["SKIP", "STOP", "EXPIRED", "T1_ONLY", "T2"]
FEATURES = ["signedBody", "lowerWick", "rangeAtr", "recoveryAtr", "sgSlope",
            "sgCurvature", "return5", "declineBars", "volumeZ", "stopAtr", "resistanceAtr",
            "bayesianShortRun", "bayesianBullishChange", "stateSlope", "stateSlopeProbability",
            "stateFlipProbability", "sgSlopeAgreement", "sgCurvatureAgreement", "sgStability",
            "atrNormalizedSlope", "relativeStrengthZ", "higherTimeframeReturn"]


def partitions(frame, test_start):
    """Purge by full label-end date, keeping every symbol on the same date together."""
    cal_start = test_start - pd.DateOffset(months=6)
    train_start = cal_start - pd.DateOffset(months=24)
    test_end = test_start + pd.DateOffset(months=3)
    train = frame[(frame.date >= train_start) & (frame.date < cal_start) & (frame.end < cal_start)]
    cal = frame[(frame.date >= cal_start) & (frame.date < test_start) & (frame.end < test_start)]
    test = frame[(frame.date >= test_start) & (frame.date < test_end) & (frame.end < test_end)]
    return train, cal, test


def estimators():
    # Fixed experiment budget; no repeatedly tuned feature/model search on outer tests.
    return {
        "elastic_net": make_pipeline(SimpleImputer(strategy="median", keep_empty_features=True),
            StandardScaler(), LogisticRegression(penalty="elasticnet", solver="saga", l1_ratio=.5,
                                                C=.1, max_iter=5000, random_state=42)),
        "additive_spline": make_pipeline(SimpleImputer(strategy="median", keep_empty_features=True),
            SplineTransformer(n_knots=3, degree=2, include_bias=False), StandardScaler(),
            LogisticRegression(C=.1, max_iter=5000, random_state=42)),
        "shallow_boosting": make_pipeline(SimpleImputer(strategy="median", keep_empty_features=True),
            GradientBoostingClassifier(n_estimators=50, max_depth=2, learning_rate=.05,
                                       min_samples_leaf=20, random_state=42)),
    }


def ordered_probabilities(model, x):
    raw = model.predict_proba(x)
    result = np.zeros((len(x), len(CLASSES)))
    for j, name in enumerate(model.classes_):
        result[:, CLASSES.index(name)] = raw[:, j]
    if not np.isfinite(result).all() or not np.allclose(result.sum(axis=1), 1):
        raise ValueError("Invalid probability simplex")
    return result


def metrics(y, p):
    actual = np.array([CLASSES.index(label) for label in y])
    onehot = np.eye(len(CLASSES))[actual]
    target1 = p[:, 3] + p[:, 4]
    wins = np.isin(actual, [3, 4]).astype(float)
    bins = np.minimum((target1 * 10).astype(int), 9)
    ece = sum(np.mean(bins == k) * abs(wins[bins == k].mean() - target1[bins == k].mean())
              for k in range(10) if np.any(bins == k))
    return {"samples": len(actual), "multiclass_brier": float(np.mean(np.sum((onehot - p) ** 2, axis=1))),
            "log_loss": float(-np.log(np.clip(p[np.arange(len(actual)), actual], 1e-15, 1)).mean()),
            "target1_brier": float(np.mean((target1 - wins) ** 2)), "target1_ece_10_bins": float(ece)}


def block_interval(frame, differences, repeats=500):
    """Paired week-block bootstrap: all stock observations in a week stay together.

    CI describes average loss improvement, NOT a per-stock probability interval.
    """
    weeks = frame.date.dt.to_period("W").astype(str).to_numpy()
    groups = [differences[weeks == week] for week in np.unique(weeks)]
    if len(groups) < 20:
        return None
    rng = np.random.default_rng(42)
    estimates = [np.concatenate([groups[i] for i in rng.integers(0, len(groups), len(groups))]).mean()
                 for _ in range(repeats)]
    return [float(v) for v in np.quantile(estimates, [.025, .975])]


def ranking_comparison(test, probability):
    """Matched 20% daily coverage; this is a signal-cohort diagnostic, NOT portfolio P&L."""
    work = test.copy()
    work["prediction"] = probability
    work["day"] = work.date.dt.normalize()
    selected, baseline = [], []
    for _, group in work.groupby("day"):
        count = max(1, int(np.ceil(len(group) * .2)))
        selected.extend(group.sort_values(["prediction", "symbol"], ascending=[False, True]).head(count).netR.tolist())
        baseline.extend(group.sort_values(["evidence", "symbol"], ascending=[False, True]).head(count).netR.tolist())
    clean = lambda values: [float(v) for v in values if pd.notna(v)]
    selected, baseline = clean(selected), clean(baseline)
    return {"coverage": .2, "model_executable_signals": len(selected), "baseline_executable_signals": len(baseline),
            "model_mean_net_r": float(np.mean(selected)) if selected else None,
            "baseline_mean_net_r": float(np.mean(baseline)) if baseline else None,
            "scope": "overlapping signal cohort; not a capital-constrained portfolio"}


def run(directory):
    raw = (directory / "observations.jsonl").read_bytes()
    manifest = json.loads((directory / "manifest.json").read_text())
    if hashlib.sha256(raw).hexdigest() != manifest["observationsSha256"]:
        raise ValueError("Dataset checksum does not match manifest")
    records = [json.loads(line) for line in raw.splitlines() if line.strip()]
    eligible = [r for r in records if r["jointOutcome"] in CLASSES and r["labelEndTime"] is not None]
    report = {"version": "prediction-research-v2", "status": "RESEARCH_ONLY", "livePromotion": False,
        "datasetSha256": manifest["observationsSha256"], "totalSignals": len(records), "matureSignals": len(eligible),
        "matureSignalsByTimeframe": {},
        "models": [], "blockers": ["Independent data-adjustment and survivorship audit required",
        "Untouched final holdout and prospective shadow evaluation required",
        "Capital-constrained portfolio, higher costs and ambiguity stress validation required"],
        "probabilityMeaning": "Joint outcomes among all signals; T1=T1_ONLY+T2, T2 subset of T1; SKIP is separate",
        "uncertaintyMeaning": "Week-block interval for loss improvement; not a per-stock probability interval"}
    if not eligible:
        report["blockers"].append("No mature signal observations")
        return report
    if any(r["featureVersion"] != "signal-close-features-v2" or r["labelVersion"] != "joint-outcomes-v2" for r in eligible):
        raise ValueError("Mixed or unsupported feature/outcome version")
    frame = pd.DataFrame([{**r["features"], "symbol": r["symbol"], "timeframe": r["timeframe"], "date": r["signalTime"], "end": r["labelEndTime"],
                           "y": r["jointOutcome"], "netR": r["target1"]["netR"],
                           "evidence": r["evidenceQualityScore"]} for r in eligible])
    frame.date = pd.to_datetime(frame.date, unit="ms")
    frame.end = pd.to_datetime(frame.end, unit="ms")
    if frame.duplicated(["symbol", "timeframe", "date"]).any():
        raise ValueError("Duplicate symbol/signal observations")
    if not (frame.end > frame.date).all():
        raise ValueError("Invalid label availability times")
    report["reservedFinalHoldoutFrom"] = {}
    for timeframe, subset in frame.groupby("timeframe"):
        subset = subset.sort_values(["date", "symbol"]).reset_index(drop=True)
        report["matureSignalsByTimeframe"][timeframe] = len(subset)
        # Timeframes are never pooled. Last 12 calendar months are untouched.
        holdout = subset.date.max().to_period("M").start_time - pd.DateOffset(months=12)
        report["reservedFinalHoldoutFrom"][timeframe] = holdout.isoformat()
        test_start = subset.date.min().to_period("M").start_time + pd.DateOffset(months=31)
        while test_start + pd.DateOffset(months=3) <= holdout:
            train, cal, test = partitions(subset, test_start)
            counts = train.y.value_counts()
            cal_counts = cal.y.value_counts()
            if len(train) < 500 or len(cal) < 150 or len(test) < 100 or any(counts.get(c, 0) < 10 or cal_counts.get(c, 0) < 5 for c in CLASSES):
                report.setdefault("skippedFolds", []).append({"timeframe": timeframe, "start": test_start.isoformat(),
                    "train": len(train), "calibration": len(cal), "test": len(test), "reason": "Insufficient sample/class coverage"})
                test_start += pd.DateOffset(months=3)
                continue
            prior = np.array([(counts.get(c, 0) + 1) / (len(train) + len(CLASSES)) for c in CLASSES])
            baseline = np.tile(prior, (len(test), 1))
            actual = np.eye(len(CLASSES))[[CLASSES.index(v) for v in test.y]]
            for name, estimator in estimators().items():
                estimator.fit(train[FEATURES], train.y)
                model = CalibratedClassifierCV(FrozenEstimator(estimator), method="sigmoid")
                model.fit(cal[FEATURES], cal.y)
                p = ordered_probabilities(model, test[FEATURES])
                improvement = np.sum((actual - baseline) ** 2, axis=1) - np.sum((actual - p) ** 2, axis=1)
                report["models"].append({"name": name, "timeframe": timeframe, "testFrom": test_start.isoformat(),
                    "metrics": metrics(test.y, p), "baseRateMetrics": metrics(test.y, baseline),
                    "brierImprovement95Interval": block_interval(test, improvement),
                    "ranking": ranking_comparison(test, p[:, 3] + p[:, 4]),
                    "trainCount": len(train), "calibrationCount": len(cal)})
            test_start += pd.DateOffset(months=3)
    if not report["models"]:
        report["blockers"].append("No chronological fold met minimum sample/class coverage")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dataset", type=Path)
    parser.add_argument("report", type=Path)
    args = parser.parse_args()
    if args.report.exists():
        raise FileExistsError("Choose a new report path")
    result = run(args.dataset)
    with args.report.open("x", encoding="utf8") as output:
        json.dump(result, output, indent=2, allow_nan=False)
    print(f"Research report saved. {len(result['models'])} model/fold evaluations. Live promotion: disabled.")
