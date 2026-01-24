/**
 * Standardized error response helpers for MCP tools
 */

export interface ToolResult {
  content: Array<{
    type: 'text';
    text: string;
  }>;
  isError?: boolean;
}

/**
 * Create a successful response
 */
export function success(data: unknown): ToolResult {
  return {
    content: [{
      type: 'text',
      text: typeof data === 'string' ? data : JSON.stringify(data, null, 2)
    }]
  };
}

/**
 * Create an error response for client errors (bad input)
 */
export function clientError(message: string): ToolResult {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ error: 'client_error', message })
    }],
    isError: true
  };
}

/**
 * Create an error response for not found resources
 */
export function notFound(resource: string, identifier: string | number): ToolResult {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        error: 'not_found',
        message: `${resource} not found`,
        identifier
      })
    }],
    isError: true
  };
}

/**
 * Create an error response for missing required parameters
 */
export function missingParam(paramName: string): ToolResult {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        error: 'missing_parameter',
        message: `Required parameter '${paramName}' is missing`
      })
    }],
    isError: true
  };
}

/**
 * Create an error response for server/database errors
 */
export function serverError(message: string): ToolResult {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        error: 'server_error',
        message
      })
    }],
    isError: true
  };
}
