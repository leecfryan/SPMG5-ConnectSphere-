import { useEffect, useRef, useId } from "react";

// First modal in the app. Built on the native <dialog> element rather than a
// hand-rolled overlay div: it gets focus trapping, Escape-to-close, and a
// backdrop for free, and top-layer stacking without a z-index fight against
// anything else on the page.
function Modal({ open, title, onClose, children }) {
  const ref = useRef(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog ref={ref} className="modal" onClose={onClose} aria-labelledby={titleId}>
      <h2 id={titleId}>{title}</h2>
      {children}
      <button type="button" className="primary" onClick={onClose}>
        OK
      </button>
    </dialog>
  );
}

export default Modal;
