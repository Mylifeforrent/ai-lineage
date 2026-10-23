"""验收：JWT 登录、RBAC 角色守卫（viewer 无写入权限）、用户管理。"""

from tests.conftest import ADMIN, create_user, login


def test_login_success_and_me(client):
    headers = login(client)
    r = client.get("/auth/me", headers=headers)
    assert r.status_code == 200
    assert r.json() == {"username": ADMIN["username"], "role": "admin"}


def test_login_wrong_password(client):
    r = client.post("/auth/login", json={"username": "admin", "password": "nope"})
    assert r.status_code == 401


def test_viewer_cannot_write(client):
    admin_headers = login(client)
    viewer_headers = create_user(client, admin_headers, "wangwu", "viewer")

    # viewer：可读、不可写
    assert client.get("/datasets", headers=viewer_headers).status_code == 200
    assert client.get("/users", headers=viewer_headers).status_code == 403
    r = client.post("/files", headers=viewer_headers,
                    files=[("files", ("x.csv", b"a,b\n1,2\n", "text/csv"))])
    assert r.status_code == 403
    r = client.post("/import", headers=viewer_headers, data={"format": "csv"})
    assert r.status_code == 403


def test_editor_can_upload_but_not_manage_users(client):
    admin_headers = login(client)
    editor_headers = create_user(client, admin_headers, "lisi", "editor")

    assert client.get("/users", headers=editor_headers).status_code == 403
    r = client.post("/users", headers=editor_headers,
                    json={"username": "x", "password": "123456", "role": "admin"})
    assert r.status_code == 403
    r = client.post("/files", headers=editor_headers,
                    files=[("files", ("x.csv", b"a,b\n1,2\n", "text/csv"))])
    assert r.status_code == 201


def test_unauthenticated_rejected(client):
    assert client.get("/datasets").status_code == 401
    assert client.get("/users").status_code == 401
