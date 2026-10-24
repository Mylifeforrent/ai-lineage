"""pydantic API 模型与导入记录结构。定位器信封：{type, input, resolved}。"""

from typing import Literal

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


# ---------- M3 编辑与标注 ----------

class AnnotationCreate(BaseModel):
    target_kind: Literal["dataset", "field", "edge"]
    target_id: str = Field(min_length=1, max_length=512)
    body: str = Field(min_length=1, max_length=4000)


class FieldPatch(BaseModel):
    description: str | None = None
    field_type: str | None = None
    # 定位器 input（或完整的 {type,input,resolved} 信封，resolved 会被重新物化）
    src_locator: dict | None = None


class EdgeCreate(BaseModel):
    from_dataset: str = Field(min_length=1)
    from_field: str | None = None
    to_dataset: str = Field(min_length=1)
    to_field: str | None = None
    transform: str | None = None
    confidence: float = Field(default=1.0, ge=0, le=1)
    note: str | None = None


class EdgePatch(BaseModel):
    transform: str | None = None
    note: str | None = None
    confidence: float | None = Field(default=None, ge=0, le=1)


class VersionTagCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    note: str | None = None


# ---------- M4 AI 对话与血缘建议 ----------

class AiChatMessage(BaseModel):
    # 只允许 user/assistant：system 提示由后端固定，避免前端覆盖工具约束
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=8000)


class AiFocus(BaseModel):
    dataset: str = Field(min_length=1, max_length=256)
    field: str | None = Field(default=None, max_length=256)


class AiChatIn(BaseModel):
    messages: list[AiChatMessage] = Field(min_length=1, max_length=50)
    focus: AiFocus | None = None


class AiSuggestIn(BaseModel):
    dataset: str = Field(min_length=1, max_length=256)
    field: str | None = Field(default=None, max_length=256)


class AiEdgeKeyIn(BaseModel):
    """AI 候选边的自然键（confirm / reject 共用）。"""

    from_dataset: str = Field(min_length=1, max_length=256)
    from_field: str | None = Field(default=None, max_length=256)
    to_dataset: str = Field(min_length=1, max_length=256)
    to_field: str | None = Field(default=None, max_length=256)


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
