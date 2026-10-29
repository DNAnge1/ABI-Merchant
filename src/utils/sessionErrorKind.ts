/** Infra errors deep-link Fix → Troubleshooting; match/diagnostic fails do not. */
export function isInfraSessionError(message: string): boolean {
  return /NotReadableError|Could not start audio source|exclusive mode|getUserMedia|getDisplayMedia|permission|audio source/i.test(
    message,
  );
}
