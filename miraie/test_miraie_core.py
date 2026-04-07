import json
import tempfile
import unittest
from pathlib import Path

import cron_manager
import miraie_scheduler as scheduler


class CronManagerTests(unittest.TestCase):
    def test_day_spec_all_for_invalid_days(self):
        self.assertEqual(cron_manager._day_spec(["Foo", "Bar"]), "*")

    def test_day_spec_for_subset_days(self):
        self.assertEqual(cron_manager._day_spec(["Mon", "Wed", "Fri"]), "1,3,5")


class SchedulerStorageTests(unittest.TestCase):
    def test_add_schedule_rounds_to_five_minutes(self):
        with tempfile.TemporaryDirectory() as td:
            schedules_file = Path(td) / "miraie_schedules.json"
            original = scheduler.SCHEDULES_FILE
            try:
                scheduler.SCHEDULES_FILE = schedules_file
                scheduler.add_schedule("08:33", "on", ["Mon"])
                schedules = scheduler.load_schedules()
                self.assertIn("08:30_on", schedules)
                self.assertEqual(schedules["08:30_on"]["time"], "08:30")
                self.assertEqual(schedules["08:30_on"]["days"], ["Mon"])
            finally:
                scheduler.SCHEDULES_FILE = original

    def test_build_payload_powerful_disables_eco(self):
        payload = json.loads(
            scheduler.build_payload("on", eco=True, powerful=True, quiet=True)
        )
        self.assertEqual(payload["ps"], "on")
        self.assertEqual(payload["tt"], "on")
        self.assertEqual(payload["ec"], "off")
        self.assertEqual(payload["qt"], "on")


if __name__ == "__main__":
    unittest.main()
