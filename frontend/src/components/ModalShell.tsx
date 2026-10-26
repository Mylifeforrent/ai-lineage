import { useRef } from 'react';
import type { ComponentProps, ReactNode, RefObject } from 'react';
import { Icon } from './Icon';
import type { IconName } from './Icon';
import { useOverlayBehavior } from '../lib/useOverlayBehavior';

/**
 * 统一浮层壳（评审 R13）：遮罩 + 卡片容器 + header（图标徽章/标题/关闭钮）
 * + body + footer 插槽；行为（Esc 栈顶协议、Tab 圈禁、焦点保存/还原、
 * body 滚动锁）内部经 useOverlayBehavior 提供，调用方不再手写。
 *
 * 样式约定（hifi 00 §7.6/§7.7，视觉零变化迁移）：
 * - 基座类固定：遮罩 z（modal 50 / drawer 40）、卡片圆角/边框/阴影/进场动画；
 * - 宽度档、max-h、flex-col 等经 `className` 追加；遮罩内边距经 `overlayClassName` 追加；
 * - `bodyClassName` / `footerClassName` / `titleClassName` 提供时**替换**默认类
 *   （避免 Tailwind 同属性类冲突），缺省用默认类；
 * - 复杂头部（eyebrow 之上的组合行 / 标题行内徽章）经 `titleNode` 整体接管；
 *   ConfirmDialog 的「徽章+标题+正文同块、无关闭钮」经 `header` 整体接管。
 */

const MODAL_OVERLAY_CLASS =
  'fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 animate-fade-in';
const DRAWER_OVERLAY_CLASS =
  'fixed inset-0 z-40 flex justify-end bg-slate-900/25 animate-fade-in';

const MODAL_CARD_CLASS =
  'relative z-[51] mx-auto w-full overflow-hidden rounded-xl border border-line bg-card shadow-modal animate-modal-in';
const DRAWER_CARD_CLASS =
  'relative z-[41] flex h-full w-full flex-col overflow-hidden border-l border-line bg-card shadow-float animate-drawer-in';

const HEADER_CLASS =
  'flex h-12 shrink-0 items-center justify-between gap-3 border-b border-line-soft px-4';
const DEFAULT_BADGE_CLASS =
  'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-brand-200 bg-brand-50 text-brand-700';
const EYEBROW_CLASS =
  'font-mono text-[11px] uppercase tracking-[0.18em] text-ink-faint';
const CLOSE_BUTTON_CLASS =
  'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-faint transition-colors duration-150 hover:bg-subtle hover:text-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-50';
const DEFAULT_BODY_CLASS = 'min-h-0 flex-1 overflow-y-auto bg-page px-4 py-4';
const DEFAULT_FOOTER_CLASS =
  'flex h-12 shrink-0 items-center justify-end gap-2 border-t border-line-soft px-4';

export interface ModalShellProps {
  /** modal = 居中卡片（z-50）；drawer = 右侧滑入抽屉（z-40）。 */
  variant: 'modal' | 'drawer';
  open: boolean;
  /** 标题文本；titleNode / header 接管时仅作契约必填与 aria 兜底。 */
  title: string;
  /** 标题元素 id：aria-labelledby 目标；titleNode 自带标题元素时须与之一致。 */
  titleId: string;
  /** header 图标徽章图标（沿用现有 8×8 品牌徽章样式）。 */
  titleIcon?: IconName;
  /** 徽章替换类（AI 抽屉用 ai 色徽章时传入完整徽章类）。 */
  badgeClassName?: string;
  /** 标题上方 mono 小字行（EdgeCreate / UserManagement / History）。 */
  eyebrow?: ReactNode;
  /** 自定义标题节点（须含 id={titleId} 的标题元素）：ImportWizard / Preview / AI。 */
  titleNode?: ReactNode;
  /** 标题元素替换类（History 的 mono 13px 标题等）。 */
  titleClassName?: string;
  /** header 右侧、关闭钮左侧的操作（刷新、复制定位器等）。 */
  headerExtra?: ReactNode;
  /** header 与 body 之间的条带（导入向导步骤条、AI 焦点条/状态横幅）。 */
  subHeader?: ReactNode;
  /** 整个 header 的自定义替换（ConfirmDialog：徽章+标题+正文同块、无关闭钮）。 */
  header?: ReactNode;
  onRequestClose: () => void;
  /** busy 等拒关态传 false：Esc / 遮罩 / 关闭钮全部拒关；默认 true。 */
  dismissable?: boolean;
  children?: ReactNode;
  footer?: ReactNode;
  /** 卡片容器追加类（宽度档、max-h-[85vh] flex flex-col 等）。 */
  className?: string;
  /** 遮罩追加类（模态内边距 p-3 sm:p-6 / p-4）。 */
  overlayClassName?: string;
  /** body 容器类：提供时替换默认类。 */
  bodyClassName?: string;
  /** body 容器透传属性（AI 抽屉的列表 ref / role=log / aria-live / aria-label）。 */
  bodyProps?: ComponentProps<'div'>;
  /** footer 容器类：提供时替换默认类。 */
  footerClassName?: string;
  /** 关闭钮 aria-label（沿用各浮层现有 i18n 键）；缺省不渲染关闭钮。 */
  closeLabel?: string;
  /** 卡片 role；ConfirmDialog 用 'alertdialog'；缺省 'dialog'。 */
  role?: 'dialog' | 'alertdialog';
  /** 打开时优先聚焦的元素；缺省聚焦关闭钮（AI 抽屉传输入框、ConfirmDialog 传取消钮）。 */
  initialFocusRef?: RefObject<HTMLElement | null>;
}

export function ModalShell({
  variant,
  open,
  title,
  titleId,
  titleIcon,
  badgeClassName,
  eyebrow,
  titleNode,
  titleClassName,
  headerExtra,
  subHeader,
  header: customHeader,
  onRequestClose,
  dismissable = true,
  children,
  footer,
  className,
  overlayClassName,
  bodyClassName,
  bodyProps,
  footerClassName,
  closeLabel,
  role = 'dialog',
  initialFocusRef,
}: ModalShellProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const { ref: bodyRef, ...bodyRest } = bodyProps ?? {};

  useOverlayBehavior(containerRef, {
    open,
    onRequestClose,
    dismissible: dismissable,
    initialFocusRef:
      initialFocusRef ?? (closeLabel !== undefined ? closeButtonRef : undefined),
  });

  if (!open) return null;

  const overlayClass =
    variant === 'modal' ? MODAL_OVERLAY_CLASS : DRAWER_OVERLAY_CLASS;
  const cardClass =
    variant === 'modal' ? MODAL_CARD_CLASS : DRAWER_CARD_CLASS;

  return (
    <div
      className={overlayClassName ? `${overlayClass} ${overlayClassName}` : overlayClass}
      onMouseDown={(event) => {
        // 仅遮罩本身（而非卡片内部冒泡）触发；busy 拒关态不响应
        if (event.target === event.currentTarget && dismissable) {
          onRequestClose();
        }
      }}
    >
      <div
        ref={containerRef}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        className={className ? `${cardClass} ${className}` : cardClass}
      >
        {customHeader ?? (
          <header className={HEADER_CLASS}>
            <div className="flex min-w-0 items-center gap-2.5">
              {titleIcon && (
                <span className={badgeClassName ?? DEFAULT_BADGE_CLASS}>
                  <Icon name={titleIcon} size={16} />
                </span>
              )}
              {eyebrow !== undefined ? (
                <div className="min-w-0">
                  <div className={EYEBROW_CLASS}>{eyebrow}</div>
                  <h2
                    id={titleId}
                    className={titleClassName ?? 'mt-0.5 text-[14px] font-semibold text-ink'}
                  >
                    {title}
                  </h2>
                </div>
              ) : (
                (titleNode ?? (
                  <h2
                    id={titleId}
                    className={titleClassName ?? 'min-w-0 text-[14px] font-semibold text-ink'}
                  >
                    {title}
                  </h2>
                ))
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {headerExtra}
              {closeLabel !== undefined && (
                <button
                  ref={closeButtonRef}
                  type="button"
                  onClick={onRequestClose}
                  disabled={!dismissable}
                  className={CLOSE_BUTTON_CLASS}
                  aria-label={closeLabel}
                >
                  <Icon name="close" size={16} />
                </button>
              )}
            </div>
          </header>
        )}

        {subHeader}

        {children != null && (
          <div
            ref={bodyRef}
            {...bodyRest}
            className={bodyClassName ?? DEFAULT_BODY_CLASS}
          >
            {children}
          </div>
        )}

        {footer != null && (
          <footer className={footerClassName ?? DEFAULT_FOOTER_CLASS}>
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
