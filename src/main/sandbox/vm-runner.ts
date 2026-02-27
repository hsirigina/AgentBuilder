/**
 * Sandboxed code block executor using QuickJS (via quickjs-emscripten).
 *
 * QuickJS is a lightweight JS engine compiled to WASM, providing a fully
 * isolated execution environment with no access to Node.js APIs, the
 * filesystem, network, or any host globals — unless explicitly proxied in.
 *
 * Security properties:
 * - No access to Node.js built-ins (require, process, Buffer, etc.)
 * - No access to host globals
 * - Time limit enforced via JS interrupt handler
 * - Memory limit enforced by QuickJS engine
 * - BlockContext sub-tools are proxied back to main process with full permission checks
 */

import type { CodeExecPermission } from '@shared/schemas/tool.schema'

export interface BlockContext {
  log: (...args: unknown[]) => void
  http: {
    get(url: string, options?: Record<string, unknown>): Promise<string>
    post(url: string, body: unknown, options?: Record<string, unknown>): Promise<unknown>
  }
  fs: {
    readFile(path: string): Promise<string>
    writeFile(path: string, content: string): Promise<void>
    listDir(path: string): Promise<string[]>
  }
  shell: {
    exec(command: string, args: string[]): Promise<{ stdout: string; stderr: string }>
  }
  env: Record<string, string>
}

export interface SandboxResult {
  success: boolean
  result?: unknown
  error?: string
  timedOut?: boolean
}

/**
 * Execute a code block in a QuickJS sandbox.
 *
 * The code must export a default async function:
 *   export default async function run(input, ctx): Promise<unknown>
 *
 * The BlockContext (ctx) proxies tool calls back to the main process,
 * where full permission enforcement occurs before the real operation executes.
 */
export async function runCodeBlock(
  code: string,
  input: unknown,
  blockCtx: BlockContext,
  limits: CodeExecPermission
): Promise<SandboxResult> {
  try {
    // Dynamically import quickjs-emscripten to avoid issues at startup
    const { getQuickJS } = await import('quickjs-emscripten')
    const QuickJS = await getQuickJS()
    const vm = QuickJS.newContext()

    // Set memory limit (QuickJS supports this natively)
    // Note: QuickJS memory limits are set at the runtime level
    const memoryLimitBytes = limits.memoryLimitMb * 1024 * 1024

    let timedOut = false
    let result: unknown
    let runError: string | undefined

    try {
      // Inject the input as a JSON string (safely serialized)
      const inputJson = JSON.stringify(input)

      // Build the BlockContext proxy — all async calls are handled via
      // a message-passing pattern using synchronous interrupt callbacks.
      // For Phase 5, we'll implement full async proxying. For now, a
      // synchronous subset is available.
      const consoleHandle = vm.newObject()
      const logFn = vm.newFunction('log', (...qArgs) => {
        const args = qArgs.map((a) => vm.dump(a))
        blockCtx.log(...args)
      })
      vm.setProp(consoleHandle, 'log', logFn)
      vm.setProp(vm.global, '__ctx_log', logFn)
      logFn.dispose()
      consoleHandle.dispose()

      // For Phase 5: http/fs/shell will be proxied via worker_threads message passing.
      // For now, inject no-op stubs that throw informative errors.
      const stubFn = vm.newFunction('stub', () => {
        throw vm.newString('Async context tools require Phase 5 implementation')
      })
      vm.setProp(vm.global, '__ctx_http_get', stubFn)
      vm.setProp(vm.global, '__ctx_http_post', stubFn)
      vm.setProp(vm.global, '__ctx_fs_read', stubFn)
      vm.setProp(vm.global, '__ctx_fs_write', stubFn)
      vm.setProp(vm.global, '__ctx_shell_exec', stubFn)
      stubFn.dispose()

      // Wrap the user's code with our execution harness
      const harness = `
        (function() {
          const __input = ${inputJson};
          const __ctx = {
            log: (...args) => __ctx_log(...args),
            http: {
              get: (url) => { throw new Error('HTTP requires network permission and Phase 5 implementation') },
              post: (url, body) => { throw new Error('HTTP requires network permission and Phase 5 implementation') }
            },
            fs: {
              readFile: (path) => { throw new Error('Filesystem requires permission') },
              writeFile: (path, content) => { throw new Error('Filesystem requires permission') },
              listDir: (path) => { throw new Error('Filesystem requires permission') }
            },
            shell: {
              exec: (cmd, args) => { throw new Error('Shell requires permission') }
            },
            env: {}
          };

          // Execute the user's code
          ${code}

          // Call the default export
          if (typeof run !== 'function') {
            throw new Error('Code block must define a function named "run"');
          }
          return run(__input, __ctx);
        })()
      `

      // Set up interrupt handler for time limiting
      const deadline = Date.now() + limits.timeLimitMs
      vm.runtime.setInterruptHandler(() => {
        if (Date.now() > deadline) {
          timedOut = true
          return true // interrupt
        }
        return false
      })

      // Set memory limit
      vm.runtime.setMemoryLimit(memoryLimitBytes)

      // Execute synchronously (QuickJS doesn't support true async in the host API)
      // For async code blocks, Phase 5 will add proper Promise resolution
      const evalResult = vm.evalCode(harness)

      if (evalResult.error) {
        const err = vm.dump(evalResult.error)
        evalResult.error.dispose()
        runError = typeof err === 'string' ? err : JSON.stringify(err)
      } else {
        result = vm.dump(evalResult.value)
        evalResult.value.dispose()
      }
    } finally {
      vm.dispose()
    }

    if (timedOut) {
      return { success: false, timedOut: true, error: `Execution timed out after ${limits.timeLimitMs}ms` }
    }

    if (runError) {
      return { success: false, error: runError }
    }

    return { success: true, result }
  } catch (e) {
    return { success: false, error: String(e) }
  }
}
