from pathlib import Path

from monorail_worker.config import REPO_ROOT, Settings, app_data_dir


def test_app_data_dir_per_platform():
    home = Path("/home/ada")
    assert app_data_dir({"LOCALAPPDATA": r"C:\Users\ada\AppData\Local"}, "win32", home) == Path(r"C:\Users\ada\AppData\Local") / "MonoRail-Metadata"
    assert app_data_dir({}, "win32", home) == home / "AppData" / "Local" / "MonoRail-Metadata"
    assert app_data_dir({}, "darwin", home) == home / "Library" / "Application Support" / "MonoRail-Metadata"
    assert app_data_dir({"XDG_DATA_HOME": "/data"}, "linux", home) == Path("/data") / "monorail-metadata"
    assert app_data_dir({}, "linux", home) == home / ".local" / "share" / "monorail-metadata"


def test_bucket_defaults_to_the_app_data_folder():
    env = {"LOCALAPPDATA": str(REPO_ROOT / "x"), "XDG_DATA_HOME": str(REPO_ROOT / "x")}
    assert Path(Settings.load(env).team_bucket) == app_data_dir(env) / "team-bucket"


def test_bucket_setting_wins():
    assert Settings.load({"TEAM_BUCKET": "gs://b/p"}).team_bucket == "gs://b/p"
    assert Path(Settings.load({"TEAM_BUCKET": "some/folder"}).team_bucket) == (REPO_ROOT / "some" / "folder").resolve()
    assert Path(Settings.load({"TEAM_BUCKET": "file://" + str(REPO_ROOT / "b")}).team_bucket) == REPO_ROOT / "b"
