"""测试夹具：临时 DATA_DIR、TestClient、登录/上传辅助。"""

import csv as csvmod
import io

import pytest
from fastapi.testclient import TestClient

ADMIN = {"username": "admin", "password": "admin-pass-123"}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("SECRET_KEY", "test-secret-key-with-32-bytes-length!!")
    monkeypatch.setenv("ADMIN_USERNAME", ADMIN["username"])
    monkeypatch.setenv("ADMIN_PASSWORD", ADMIN["password"])
    from lineagelite.main import create_app

    app = create_app()
    with TestClient(app) as c:
        yield c


def login(client: TestClient, username: str = ADMIN["username"],
          password: str = ADMIN["password"]) -> dict:
    r = client.post("/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def create_user(client: TestClient, headers: dict, username: str,
                role: str) -> dict:
    r = client.post("/users", headers=headers,
                    json={"username": username, "password": "user-pass-123",
                          "role": role})
    assert r.status_code == 201, r.text
    return login(client, username, "user-pass-123")


def upload(client: TestClient, headers: dict, files: list[tuple]) -> list[dict]:
    r = client.post("/files", headers=headers,
                    files=[("files", f) for f in files])
    assert r.status_code == 201, r.text
    return r.json()


def csv_bytes(rows: list[list]) -> bytes:
    buf = io.StringIO()
    csvmod.writer(buf).writerows(rows)
    return buf.getvalue().encode("utf-8")
