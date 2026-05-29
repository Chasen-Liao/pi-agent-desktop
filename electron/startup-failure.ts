export function getStartupFailureDisposition({
  uiReady,
  message,
}: {
  uiReady: boolean;
  message: string;
}) {
  return {
    shouldShowStartupPage: uiReady,
    shouldQuit: !uiReady,
    message,
  };
}
