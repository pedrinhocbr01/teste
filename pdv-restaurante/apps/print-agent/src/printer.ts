import net from 'net';

/** Envia bytes RAW para a térmica via TCP (porta 9100). */
export function printTcp(host: string, port: number, data: Buffer, timeoutMs = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    const sock = new net.Socket();
    const done = (err?: Error) => {
      sock.destroy();
      if (err) reject(err);
      else resolve();
    };
    sock.setTimeout(timeoutMs);
    sock.once('timeout', () => done(new Error(`timeout imprimindo em ${host}:${port}`)));
    sock.once('error', (e) => done(e instanceof Error ? e : new Error(String(e))));
    sock.connect(port, host, () => {
      sock.write(data, (err) => {
        if (err) return done(err instanceof Error ? err : new Error(String(err)));
        // dá um respiro p/ a impressora puxar o buffer antes de fechar
        setTimeout(() => done(), 300);
      });
    });
  });
}
