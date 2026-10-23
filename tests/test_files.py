"""验收：源文件托管上传、sha256 去重、受控下载。"""

from tests.conftest import login, upload
from tests.fixtures import user_csv_bytes


def test_upload_dedupes_by_sha256(client):
    headers = login(client)
    first = upload(client, headers, [("用户表.csv", user_csv_bytes(), "text/csv")])
    second = upload(client, headers, [("用户表.csv", user_csv_bytes(), "text/csv")])

    assert first[0]["deduped"] is False
    assert second[0]["deduped"] is True
    assert second[0]["id"] == first[0]["id"]

    listed = client.get("/files", headers=headers).json()
    assert len(listed) == 1
    assert listed[0]["sha256"] == first[0]["sha256"]


def test_upload_rejects_unknown_type(client):
    headers = login(client)
    r = client.post("/files", headers=headers,
                    files=[("files", ("x.exe", b"MZ", "application/octet-stream"))])
    assert r.status_code == 400


def test_download_returns_original_content(client):
    from urllib.parse import unquote

    headers = login(client)
    rec = upload(client, headers, [("用户表.csv", user_csv_bytes(), "text/csv")])[0]
    r = client.get(f"/files/{rec['id']}/download", headers=headers)
    assert r.status_code == 200
    assert r.content == user_csv_bytes()
    # Starlette 对非 ASCII 文件名做 URL 编码（filename*=utf-8''...），unquote 后比对
    assert "用户表.csv" in unquote(r.headers["content-disposition"])
