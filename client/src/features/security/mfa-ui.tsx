import { Copy, Download } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { MfaSetupDto } from '@arihant/shared';
import { Button } from '@/components/ui/button';

/** QR code for the authenticator app, plus the key for typing in by hand. */
export function MfaQr({ setup }: { setup: MfaSetupDto }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(setup.otpauthUrl, { margin: 1, width: 180 })
      .then((url) => live && setSrc(url))
      .catch(() => live && setSrc(null));
    return () => {
      live = false;
    };
  }, [setup.otpauthUrl]);
  const grouped = setup.secret.replace(/(.{4})/g, '$1 ').trim();
  return (
    <div className="flex flex-wrap items-center gap-4">
      {src ? (
        <img
          src={src}
          width={180}
          height={180}
          alt="QR code to add Arihant Workspace to your authenticator app"
          className="rounded-lg border bg-white p-1"
        />
      ) : null}
      <div className="space-y-1 text-sm">
        <p>
          Scan the code with Microsoft Authenticator, Google Authenticator or a similar app, or
          enter this key:
        </p>
        <code
          className="block rounded bg-muted px-2 py-1 font-mono text-xs break-all"
          aria-label="Setup key"
        >
          {grouped}
        </code>
      </div>
    </div>
  );
}

/** One-time recovery codes with copy and download. */
export function RecoveryCodes({ codes }: { codes: string[] }) {
  const text = codes.join('\n');
  return (
    <div className="space-y-2" role="region" aria-label="Recovery codes">
      <p className="text-sm">
        Keep these recovery codes somewhere safe. Each works once if you lose your phone. They are
        shown only now.
      </p>
      <ul className="grid grid-cols-2 gap-1 rounded-lg border bg-muted/40 p-3 font-mono text-sm">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            void navigator.clipboard?.writeText(text).then(() => toast.success('Copied'))
          }
        >
          <Copy /> Copy
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
            const a = document.createElement('a');
            a.href = url;
            a.download = 'arihant-workspace-recovery-codes.txt';
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}
        >
          <Download /> Download
        </Button>
      </div>
    </div>
  );
}
