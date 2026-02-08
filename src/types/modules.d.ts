// Type declarations for modules without TypeScript definitions

declare module 'oui-data' {
  const data: Record<string, string>
  export default data
}

declare module 'oui' {
  function lookup(mac: string): string | null
  export { lookup }
}

declare module 'multicast-dns' {
  import { EventEmitter } from 'events'

  interface MdnsQuestion {
    name: string
    type: string
  }

  interface MdnsAnswer {
    name: string
    type: string
    data: string | Buffer | { target?: string; port?: number; priority?: number; weight?: number }
    ttl?: number
  }

  interface MdnsResponse {
    id: number
    type: 'response'
    questions: MdnsQuestion[]
    answers: MdnsAnswer[]
    additionals: MdnsAnswer[]
  }

  interface MdnsInstance extends EventEmitter {
    query(query: { questions: MdnsQuestion[] }): void
    destroy(): void
    on(event: 'response', listener: (response: MdnsResponse) => void): this
    on(event: 'error', listener: (err: Error) => void): this
  }

  function mdns(): MdnsInstance

  export = mdns
}
