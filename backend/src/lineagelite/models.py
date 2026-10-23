"""pydantic API 模型与导入记录结构。定位器信封：{type, input, resolved}。"""

from pydantic import BaseModel, Field


# ---------- 定位器输入（用户填写的 input 部分） ----------

class CsvLocatorIn(BaseModel):
    column: int | None = Field(default=None, ge=1)
    header: str | None = None


class XlsxLocatorIn(BaseModel):
    sheet: str
    column: str | None = None
    row_start: int | None = Field(default=None, ge=1)
    row_end: int | None = Field(default=None, ge=1)
    header_path: list[str] | None = None
    header_rows: int | None = Field(default=None, ge=1)


class JsonLocatorIn(BaseModel):
    json_path: str


# ---------- API 请求/响应 ----------

class LoginIn(BaseModel):
    username: str
    password: str


class UserCreate(BaseModel):
    username: str = Field(min_length=2, max_length=64)
    password: str = Field(min_length=6)
    display_name: str | None = None
    role: str = Field(pattern="^(admin|editor|viewer)$")


class UserOut(BaseModel):
    username: str
    display_name: str | None
    role: str


# ---------- 导入记录（清单行归一化结果） ----------

class DatasetFieldRecord(BaseModel):
    row: int
    dataset_id: str
    dataset_name: str | None = None
    field_name: str
    field_type: str | None = None
    src_file: str
    src_type: str
    src_locator: dict
    description: str | None = None
    parse_error: str | None = None  # 行级解析错误：非空时整行拒绝（不整批 400）


class LineageEdgeRecord(BaseModel):
    row: int
    from_dataset: str
    from_field: str | None = None
    to_dataset: str
    to_field: str | None = None
    transform: str | None = None
    confidence: float | None = None
    note: str | None = None
    parse_error: str | None = None  # 行级解析错误：非空时整行拒绝（不整批 400）


class ImportReportItem(BaseModel):
    status: str  # ok | merged | rejected
    kind: str  # field | edge
    ref: str
    reason: str | None = None
    source_row: int


class ImportReport(BaseModel):
    summary: dict
    items: list[ImportReportItem]
