import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

/**
 * 浮层行为基座（评审 R13）：全部覆盖层统一接入，替代各浮层手写的
 * document keydown / Tab trap / 焦点保存 / body 滚动锁。
 *
 * - 焦点保存/还原：打开时记录 `document.activeElement`，关闭/卸载时还原；
 * - Tab 圈禁：Tab / Shift+Tab 时焦点不可逃逸出容器（含焦点丢失到容器外时拉回）；
 * - Esc 栈：模块级浮层栈（后开者优先），只有栈顶响应 Esc——
 *   AI 抽屉与版本抽屉同开时，一次 Esc 只关最近一层；
 * - body 滚动锁：打开时保存旧值并锁定 `body.style.overflow = 'hidden'`，
 *   关闭/卸载时按栈序还原（多层同开不互相踩踏）。
 *
 * `onRequestClose` / `dismissible` 经内部 ref 读取：父组件回调不稳定时
 * 监听器不重挂、不产生过期闭包；busy 态传 `dismissible: false` 拒关。
 */

/** 可聚焦元素选择器（沿用原 ImportWizardModal 实现，含 summary）。 */
const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

interface OverlayStackEntry {
  requestClose: () => void;
}

/** 模块级浮层栈：只有栈顶（最后入栈者）响应 Esc 与 Tab 圈禁。 */
const overlayStack: OverlayStackEntry[] = [];

export interface OverlayBehaviorOptions {
  open: boolean;
  onRequestClose: () => void;
  /** false（busy 等拒关态）时 Esc 被吞掉不关闭；默认 true。 */
  dismissible?: boolean;
  /** 打开时优先聚焦的元素（关闭钮/输入框/取消钮）；缺省聚焦容器内第一个可聚焦元素。 */
  initialFocusRef?: RefObject<HTMLElement | null>;
}

export function useOverlayBehavior(
  containerRef: RefObject<HTMLElement | null>,
  options: OverlayBehaviorOptions,
): void {
  const { open, onRequestClose, dismissible = true, initialFocusRef } = options;

  // 关键回调经 ref 读取：监听器只在 open 期间挂一次也能拿到最新值。
  const latestRef = useRef({ onRequestClose, dismissible });
  useEffect(() => {
    latestRef.current = { onRequestClose, dismissible };
  });

  const entryRef = useRef<OverlayStackEntry | null>(null);
  if (entryRef.current === null) {
    entryRef.current = {
      requestClose: () => latestRef.current.onRequestClose(),
    };
  }

  useEffect(() => {
    if (!open) return;
    const container = containerRef.current;
    const entry = entryRef.current;
    if (!container || !entry) return;

    const isTopOfStack = (): boolean =>
      overlayStack[overlayStack.length - 1] === entry;

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        // 一次 Esc 只关最近打开的一层（如 AI 抽屉 + 版本抽屉同开）
        if (!isTopOfStack()) return;
        event.preventDefault();
        if (latestRef.current.dismissible) {
          latestRef.current.onRequestClose();
        }
        return;
      }
      if (event.key !== 'Tab' || !isTopOfStack()) return;
      const focusable = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      // 焦点已落到容器外（遮罩外的背景）：拉回圈内，Shift+Tab 从末尾进
      if (!active || !container.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey) {
        if (active === first || !focusable.includes(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !focusable.includes(active)) {
        event.preventDefault();
        first.focus();
      }
    };

    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    overlayStack.push(entry);
    document.addEventListener('keydown', handleKeyDown);

    // 初始焦点：优先指定元素；若焦点已在容器内（如 autoFocus 元素）则尊重现状；
    // 指定元素不可聚焦（如 disabled 输入框）时回退容器内第一个可聚焦元素。
    const activeNow =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    if (!activeNow || !container.contains(activeNow)) {
      const preferred = initialFocusRef?.current ?? null;
      if (preferred) preferred.focus();
      const focusedNow =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      if (!focusedNow || !container.contains(focusedNow)) {
        container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();
      }
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      const index = overlayStack.indexOf(entry);
      if (index !== -1) overlayStack.splice(index, 1);
      document.body.style.overflow = previousOverflow;
      if (previousFocus && previousFocus.isConnected) {
        previousFocus.focus();
      }
    };
    // containerRef / initialFocusRef / entryRef 均为调用方 useRef，身份稳定；
    // onRequestClose 与 dismissible 经 latestRef 读取，父渲染不重挂监听器。
  }, [open, containerRef, initialFocusRef, entryRef]);
}
