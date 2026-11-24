export interface FormattedAuthError {
  code: string;
  message: string;
}

export function formatLocalAuthError(
  error: unknown,
  extraCode?: string,
): FormattedAuthError {
  const rawCode =
    extraCode ||
    (typeof (error as { code?: unknown })?.code === 'string'
      ? (error as { code: string }).code
      : '');
  const rawMessage =
    error instanceof Error ? error.message : String(error || 'Authentication failed.');
  const lower = `${rawCode} ${rawMessage}`.toLowerCase();

  if (lower.includes('too-many-requests') || lower.includes('locked')) {
    return {
      code: 'auth/too-many-requests',
      message: rawMessage || 'Too many sign-in attempts. Please wait a moment and try again.',
    };
  }

  if (lower.includes('email-in-use') || lower.includes('already exists')) {
    return {
      code: 'auth/email-in-use',
      message: rawMessage || 'An account with this email already exists. Please sign in instead.',
    };
  }

  if (lower.includes('invalid-credentials') || lower.includes('incorrect')) {
    return {
      code: 'auth/invalid-credentials',
      message: rawMessage || 'Incorrect email/username or password.',
    };
  }

  if (lower.includes('failed to fetch') || lower.includes('network')) {
    return {
      code: 'auth/network-error',
      message: 'Connection interrupted while reaching XEROTV authentication. Please try again.',
    };
  }

  return {
    code: rawCode || 'auth/error',
    message: rawMessage,
  };
}
