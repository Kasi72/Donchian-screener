"""Run: python -m unittest discover -s scripts -p test_prediction_models.py"""
import unittest
import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.frozen import FrozenEstimator
from train_prediction_models import (CLASSES, FEATURES, partitions, estimators,
                                     ordered_probabilities, metrics, block_interval)


class PredictionTests(unittest.TestCase):
    def test_label_overlap_is_purged_and_dates_stay_together(self):
        frame = pd.DataFrame({"date": pd.to_datetime(["2023-12-20", "2023-12-29", "2024-01-01", "2024-06-28", "2024-07-01"]),
                              "end": pd.to_datetime(["2023-12-30", "2024-01-05", "2024-01-15", "2024-07-05", "2024-07-15"])})
        train, cal, test = partitions(frame, pd.Timestamp("2024-07-01"))
        self.assertEqual(train.index.tolist(), [0])
        self.assertEqual(cal.index.tolist(), [2])
        self.assertEqual(test.index.tolist(), [4])

    def test_models_produce_coherent_joint_probabilities(self):
        rng = np.random.default_rng(17)
        x = pd.DataFrame(rng.normal(size=(300, len(FEATURES))), columns=FEATURES)
        y = np.array(CLASSES * 60)
        for name, estimator in estimators().items():
            with self.subTest(model=name):
                estimator.fit(x.iloc[:200], y[:200])
                calibrated = CalibratedClassifierCV(FrozenEstimator(estimator), method="sigmoid")
                calibrated.fit(x.iloc[200:250], y[200:250])
                p = ordered_probabilities(calibrated, x.iloc[250:])
                self.assertTrue(np.allclose(p.sum(axis=1), 1))
                self.assertTrue((p[:, 4] <= p[:, 3] + p[:, 4]).all())
                self.assertTrue(np.isfinite(metrics(y[250:], p)["log_loss"]))

    def test_perfect_predictions_have_zero_brier(self):
        self.assertEqual(metrics(CLASSES, np.eye(5))["multiclass_brier"], 0)

    def test_uncertainty_requires_independent_time_blocks(self):
        small = pd.DataFrame({"date": pd.date_range("2024-01-01", periods=10)})
        self.assertIsNone(block_interval(small, np.ones(10)))
        long = pd.DataFrame({"date": pd.date_range("2024-01-01", periods=200)})
        self.assertEqual(block_interval(long, np.ones(200), repeats=10), [1, 1])


if __name__ == "__main__":
    unittest.main()
