/**
 * 中文聚合字典（默认语言，消息键的类型基准）。
 *
 * 各命名空间词条在 dicts/ 下按组件分模块维护，此处只做聚合；
 * 新增模块时在此追加 import 与展开（并行改造约定：字典模块各自独立，不互相编辑）。
 */
import { zhCommon } from './dicts/common';
import { zhApp } from './dicts/app';
import { zhToast } from './dicts/toast';
import { zhBrand } from './dicts/brand';
import { zhSourceBadge } from './dicts/sourceBadge';
import { zhGroupNode } from './dicts/groupNode';
import { zhDatasetNode } from './dicts/datasetNode';
import { zhLineageEdge } from './dicts/lineageEdge';
import { zhConfirmDialog } from './dicts/confirmDialog';
import { zhTopbar } from './dicts/topbar';
import { zhLogin } from './dicts/login';
import { zhWorkspace } from './dicts/workspace';
import { zhSidebar } from './dicts/sidebar';
import { zhHistory } from './dicts/history';
import { zhUserMgmt } from './dicts/userMgmt';
import { zhVersion } from './dicts/version';
import { zhEdgeDetail } from './dicts/edgeDetail';
import { zhCanvas } from './dicts/canvas';
import { zhPreview } from './dicts/preview';
import { zhAi } from './dicts/ai';
import { zhDetail } from './dicts/detail';
import { zhImportWiz } from './dicts/importWiz';
import { zhEdgeCreate } from './dicts/edgeCreate';
import { zhAnnotation } from './dicts/annotation';
import { zhFormat } from './dicts/format';
import { zhApi } from './dicts/api';
import { zhLangToggle } from './dicts/langToggle';

export const zh = {
  ...zhCommon,
  ...zhApp,
  ...zhToast,
  ...zhBrand,
  ...zhSourceBadge,
  ...zhGroupNode,
  ...zhDatasetNode,
  ...zhLineageEdge,
  ...zhConfirmDialog,
  ...zhTopbar,
  ...zhLogin,
  ...zhWorkspace,
  ...zhSidebar,
  ...zhHistory,
  ...zhUserMgmt,
  ...zhVersion,
  ...zhEdgeDetail,
  ...zhCanvas,
  ...zhPreview,
  ...zhAi,
  ...zhDetail,
  ...zhImportWiz,
  ...zhEdgeCreate,
  ...zhAnnotation,
  ...zhFormat,
  ...zhApi,
  ...zhLangToggle,
};
