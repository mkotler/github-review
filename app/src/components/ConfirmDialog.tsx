/**
 * ConfirmDialog - Reusable confirmation dialog component
 */

export interface ConfirmDialogProps {
  /** Dialog title */
  title: string;
  /** Dialog message/body content */
  message: string;
  /** Text for the confirm button */
  confirmText?: string;
  /** Text for the cancel button */
  cancelText?: string;
  /** Whether the confirm button should use danger styling */
  isDanger?: boolean;
  /** Handler called when dialog is closed (cancel or backdrop click) */
  onClose: () => void;
  /** Handler called when confirm button is clicked. If not provided, only shows OK button. */
  onConfirm?: () => void;
}

/**
 * A reusable confirmation dialog with optional cancel/confirm buttons.
 * When onConfirm is not provided, shows only an OK button for informational dialogs.
 */
export function ConfirmDialog({
  title,
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  isDanger = false,
  onClose,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{title}</h3>
        </div>
        <div className="modal-body">
          <p>{message}</p>
        </div>
        <div className="modal-footer">
          {onConfirm ? (
            <>
              <button
                type="button"
                className="modal-button modal-button--secondary"
                onClick={onClose}
              >
                {cancelText}
              </button>
              <button
                type="button"
                className={`modal-button ${isDanger ? 'modal-button--danger' : 'modal-button--primary'}`}
                onClick={() => {
                  onConfirm();
                  onClose();
                }}
              >
                {confirmText}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="modal-button modal-button--secondary"
              onClick={onClose}
            >
              OK
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default ConfirmDialog;
