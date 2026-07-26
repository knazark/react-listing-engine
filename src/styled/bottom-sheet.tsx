'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface IBottomSheetProps {
	open: boolean;
	onOpenChange(open: boolean): void;
	title?: string;
	children?: ReactNode;
	footer?: ReactNode;
}

/**
 * Dependency-free mobile bottom sheet -- the `/styled` adapter's own modal
 * primitive, used by `StyledListingLayout` for the mobile filters panel.
 * Deliberately dependency-free (no Radix or other UI-library sheet): `/styled`
 * ships zero UI dependencies beyond `react`/`react-dom`, so this is a small
 * hand-rolled implementation covering just what a filters sheet needs --
 * portal, backdrop-click/Escape-to-close, a body-scroll lock, and the
 * `.rle-sheet--open` slide-up transition. Not a full focus trap (Tab can
 * still escape to the rest of the page while open) -- only initial focus
 * placement, which is enough for this component's scope; a real focus trap
 * is a documented future enhancement if/when this needs to satisfy a
 * stricter modal-dialog a11y bar.
 *
 * MOUNT/ANIMATE: rendering is driven by two pieces of state instead of one --
 * `rendered` (is the sheet in the DOM at all) flips synchronously with
 * `open`, but `animateOpen` (does it carry the `.rle-sheet--open` class) is
 * deferred one animation frame past mount. That gap is what lets the
 * transform transition actually run: mounting directly with `.rle-sheet--open`
 * already applied would paint the very first frame already in its final
 * (slid-up) position, and a CSS transition never animates a property that
 * never visibly changes. On close, both flags drop together and the sheet
 * unmounts immediately -- no exit animation. Simpler than tracking an
 * exit-in-progress phase, and an acceptable trade-off for a filters sheet
 * (see the task brief: "keep it mounted briefly for exit or just unmount --
 * simple is fine").
 *
 * SSR-safe: `document` is only ever touched inside effects/the portal-target
 * check below, never during the render body itself, so this component is
 * inert (renders nothing) until it has mounted client-side.
 */
export function BottomSheet({ open, onOpenChange, title, children, footer }: IBottomSheetProps) {
	const sheetRef = useRef<HTMLDivElement | null>(null);
	const [rendered, setRendered] = useState(false);
	const [animateOpen, setAnimateOpen] = useState(false);

	useEffect(() => {
		if (!open) {
			setAnimateOpen(false);
			setRendered(false);
			return;
		}

		setRendered(true);
		const frame = requestAnimationFrame(() => setAnimateOpen(true));
		return () => cancelAnimationFrame(frame);
	}, [open]);

	// Body scroll lock -- restores whatever inline `overflow` value (if any)
	// was already set, rather than unconditionally clearing it, so this
	// doesn't clobber a host app's own inline style on `<body>`.
	useEffect(() => {
		if (!rendered) return;

		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.body.style.overflow = previousOverflow;
		};
	}, [rendered]);

	// Initial focus placement (not a full focus trap -- see doc comment above)
	// + Escape-to-close.
	useEffect(() => {
		if (!rendered) return;

		sheetRef.current?.focus();

		function handleKeyDown(event: KeyboardEvent): void {
			if (event.key === 'Escape') onOpenChange(false);
		}

		document.addEventListener('keydown', handleKeyDown);
		return () => document.removeEventListener('keydown', handleKeyDown);
	}, [rendered, onOpenChange]);

	if (!rendered || typeof document === 'undefined') return null;

	return createPortal(
		<>
			<div
				className={`rle-sheet-backdrop${animateOpen ? ' rle-sheet-backdrop--open' : ''}`}
				onClick={() => onOpenChange(false)}
				aria-hidden="true"
			/>
			<div
				ref={sheetRef}
				className={`rle-sheet${animateOpen ? ' rle-sheet--open' : ''}`}
				role="dialog"
				aria-modal="true"
				aria-label={title}
				tabIndex={-1}
			>
				<div className="rle-sheet__handle" aria-hidden="true" />
				<div className="rle-sheet__header">
					{title && <div className="rle-sheet__title">{title}</div>}
					<button
						type="button"
						className="rle-sheet__close"
						onClick={() => onOpenChange(false)}
						aria-label="Close"
					>
						<CloseIcon />
					</button>
				</div>
				<div className="rle-sheet__body">{children}</div>
				{footer && <div className="rle-sheet__footer">{footer}</div>}
			</div>
		</>,
		document.body,
	);
}

function CloseIcon() {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={2}
			strokeLinecap="round"
			strokeLinejoin="round"
			width="16"
			height="16"
			aria-hidden="true"
		>
			<path d="M18 6 6 18" />
			<path d="m6 6 12 12" />
		</svg>
	);
}
