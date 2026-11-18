import os
import tempfile

_tmp = tempfile.mkdtemp(prefix="fg-test-")
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/test.db"
os.environ["MEDIA_DIR"] = f"{_tmp}/media"
os.environ["DB_AUTO_INIT"] = "false"
os.environ["ADMIN_PASSWORD"] = "admin123"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.db import Base, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.seed import init_db  # noqa: E402

HEADERS = {"X-Requested-With": "family-graph"}


@pytest.fixture(scope="session", autouse=True)
def database():
    Base.metadata.create_all(engine)
    init_db(migrate=False)
    yield


def make_client() -> TestClient:
    c = TestClient(app)
    c.headers.update(HEADERS)
    return c


def login(c: TestClient, username: str, password: str) -> dict:
    r = c.post("/api/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="session")
def admin():
    c = make_client()
    data = login(c, "admin", "admin123")
    if data["must_change_password"]:
        r = c.post("/api/auth/change-password", json={"old_password": "admin123", "new_password": "Admin12345"})
        assert r.status_code == 200, r.text
    return c
