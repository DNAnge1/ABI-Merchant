/** Infra errors deep-link Fix → Troubleshooting; match/diagnostic fails do not. */
export function isInfraSessionError(message: string): boolean {
  return /NotReadableError|Could not start audio source|exclusive mode|getUserMedia|getDisplayMedia|permission|audio source|No Audio Track|video only|share picker/i.test(
    message,
  );
}

/**
 * Share-picker / attach failures that should clear once audio is flowing
 * (successful Start Listening, Live Peek, or Final lock).
 */
export function isRecoveredShareError(message: string): boolean {
  return /No Audio Track|video only|share picker|Also share system audio|Share tab audio|Could not start audio source|NotReadableError|audioTracks=0/i.test(
    message,
  );
}
