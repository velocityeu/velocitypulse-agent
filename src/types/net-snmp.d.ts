declare module 'net-snmp' {
  interface SessionOptions {
    timeout?: number
    retries?: number
    version?: number
  }

  interface Varbind {
    oid: string
    type: number
    value: Buffer | string
  }

  interface Session {
    get(oids: string[], callback: (error: Error | null, varbinds: Varbind[]) => void): void
    close(): void
  }

  const Version2c: number

  function createSession(target: string, community: string, options?: SessionOptions): Session
  function isVarbindError(varbind: Varbind): boolean
}
