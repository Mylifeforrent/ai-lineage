import { Handle, Position } from '@xyflow/react';
import type { Node, NodeProps } from '@xyflow/react';
import {
  TABLE_SOURCE_HANDLE,
  TABLE_TARGET_HANDLE,
} from '../lib/handles';
import { Icon } from './Icon';

/**
 * 「折叠为组」占位节点（M3 前端最小实现）。
 *
 * 取舍说明：不引入 dagre 的 compound（子图）布局，也不改后端子图契约；
 * 组节点只是把多选成员在**视图层**隐藏后放在成员包围盒中心。
 * - 成员原本的字段级/表级边在组内互相抵消；
 * - 跨组边聚合为一条组级连线，指向本节点的表级 handle；
 * - 点击节点或「展开」按钮即解散该组（不写后端）。
 */
export interface GroupNodeData extends Record<string, unknown> {
  label: string;
  memberIds: string[];
  onExpand: (groupId: string) => void;
}

export type GroupFlowNode = Node<GroupNodeData, 'group'>;

export function GroupNode({ id, data }: NodeProps) {
  const nodeData = data as unknown as GroupNodeData;
  const { label, memberIds, onExpand } = nodeData;
  const count = memberIds.length;

  return (
    <article
      className="group relative w-[248px] rounded-[14px] border border-dashed border-pine-400/70 bg-pine-50/85 p-3 shadow-node transition-shadow hover:shadow-card"
      aria-label={`折叠分组 ${label}，包含 ${count} 个数据集，点击展开`}
    >
      <Handle
        type="target"
        position={Position.Left}
        id={TABLE_TARGET_HANDLE}
        className="table-handle"
        style={{ top: 30 }}
        isConnectable={false}
      />
      <Handle
        type="source"
        position={Position.Right}
        id={TABLE_SOURCE_HANDLE}
        className="table-handle"
        style={{ top: 30 }}
        isConnectable={false}
      />
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onExpand(id);
        }}
        className="nodrag nopan block w-full text-left focus-visible:outline-none"
        title="展开该分组"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-pine-200 bg-surface text-pine-700">
            <Icon name="group" size={14} />
          </span>
          <span className="rounded-full border border-pine-200 bg-surface px-1.5 py-[1px] font-mono text-[8.5px] text-pine-700">
            {count} 个数据集
          </span>
        </div>
        <h3 className="mt-2 truncate text-[11.5px] font-semibold text-pine-900">
          {label}
        </h3>
        <div className="mt-1 flex items-center gap-1.5 font-mono text-[8.5px] text-pine-700/75">
          <Icon name="unfold-all" size={10} />
          点击展开
        </div>
      </button>
    </article>
  );
}
