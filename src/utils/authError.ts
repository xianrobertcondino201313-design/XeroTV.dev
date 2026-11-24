export interface FormattedAuthError {
  code: string;
  message: string;
  isUnauthorizedDomain: boolean;
  hostname: string;
}

export function formatFirebaseAuthError(error: unknown, hostname: string = ''): FormattedAuthError {
  const rawCode =
    typeof (error as { code?: unknown })?.code === 'string'
      ? (error as { code: string }).code
      : '';
  const rawMessage = error instanceof Error ? error.message : String(error || 'Sign-in failed.');
  const lower = `${rawCode} ${rawMessage}`.toLowerCase();

  if (lower.includes('unauthorized-domain')) {
    return {
      code: 'auth/unauthorized-domain',
      message: `Domain "${hostname || 'this site'}" is not authorized in Firebase Auth yet.`,
      isUnauthorizedDomain: true,
      hostname,
    };
  }
  if (lower.includes('popup-blocked')) {
    return {
      code: 'auth/popup-blocked',
      message: 'Sign-in popup was blocked by your browser. Allow popups for this site and try again.',
      isUnauthorizedDomain: false,
      hostname,
    };
  }
  if (lower.includes('popup-closed-by-user') || lower.includes('cancelled-popup-request')) {
    return {
      code: rawCode || 'auth/popup-closed-by-user',
      message: 'Google Sign-In window was closed before finishing.',
      isUnauthorizedDomain: false,
      hostname,
    };
  }
  if (lower.includes('network-request-failed')) {
    return {
      code: 'auth/network-request-failed',
      message: 'Network connection interrupted during Google Sign-In. Check your internet and try again.',
      isUnauthorizedDomain: false,
      hostname,
    };
  }

  return {
    code: rawCode || 'auth/unknown',
    message: rawMessage,
    isUnauthorizedDomain: false,
    hostname,
  };
}
