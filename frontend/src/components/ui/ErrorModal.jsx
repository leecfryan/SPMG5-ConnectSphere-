import Modal from "./Modal";

// Shared display for a blocked action - a 403 from any feature ("You do not
// have permission...") or any other error message a caller wants to surface
// as a dialog rather than inline text. Wraps the generic Modal so every
// feature shows access errors the same way instead of each rolling its own.
function ErrorModal({ open, message, onClose, title = "Something went wrong" }) {
  return (
    <Modal open={open} title={title} onClose={onClose}>
      <p role="alert">{message}</p>
    </Modal>
  );
}

export default ErrorModal;
