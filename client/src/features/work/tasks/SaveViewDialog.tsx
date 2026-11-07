import { useState } from 'react';
import { FormField } from '@/components/common/FormField';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

/** Mounted only while open, so the name starts empty each time. */
export function SaveViewDialog({
  onSave,
  onClose,
  pending,
}: {
  onSave: (name: string) => void;
  onClose: () => void;
  pending: boolean;
}) {
  const [name, setName] = useState('');
  const valid = name.trim().length > 0 && name.trim().length <= 60;
  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Save view</DialogTitle>
          <DialogDescription>
            Saves the current view type and filters for you only.
          </DialogDescription>
        </DialogHeader>
        <form
          id="save-view"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) onSave(name.trim());
          }}
        >
          <FormField label="Name">
            <Input
              autoFocus
              maxLength={60}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. My critical bugs"
            />
          </FormField>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="save-view" disabled={!valid || pending}>
            {pending ? 'Saving…' : 'Save view'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
