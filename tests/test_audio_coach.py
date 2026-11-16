"""Browser speech and interactive coach smoke checks."""
from pathlib import Path
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]


class AudioCoachContractTests(unittest.TestCase):
    def test_html_loads_audio_engine_before_app(self):
        html = (ROOT / "site/index.html").read_text(encoding="utf-8")
        self.assertLess(html.index("speech.js"), html.index("app.js"))

    def test_all_data_sections_use_same_audio_engine(self):
        app = (ROOT / "site/app.js").read_text(encoding="utf-8")
        engine = (ROOT / "site/speech.js").read_text(encoding="utf-8")
        self.assertIn("window.DQAudio.play(text)", app)
        self.assertIn("window.DQAudio.enhance(view)", app)
        self.assertIn("function usageExamples(", app)
        self.assertIn("'example-next'", app)
        self.assertIn("function coachView(", app)
        self.assertIn("'coach-mic'", app)
        self.assertIn("'coach-record'", app)
        self.assertIn("'coach-record-stop'", app)
        self.assertIn("data-act=\"coach\"", app)
        self.assertIn("recognition.lang = 'de-DE'", engine)
        self.assertIn("utter.lang = 'de-DE'", engine)
        self.assertIn("function startRecording(", engine)

    @unittest.skipUnless(shutil.which("node"), "Node.js not installed")
    def test_scripts_are_valid_javascript(self):
        for script in ["site/speech.js", "site/app.js"]:
            with self.subTest(script=script):
                subprocess.run(["node", "--check", str(ROOT / script)],
                               check=True, capture_output=True, text=True)


if __name__ == "__main__":
    unittest.main()
