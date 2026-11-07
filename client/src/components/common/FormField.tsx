import { useId, type ReactElement, type ReactNode } from 'react';
import { cloneElement, isValidElement } from 'react';
import { Label } from '@/components/ui/label';
import { FieldContext } from './field-context';
import { cn } from '@/lib/utils';

interface FormFieldProps {
  label: ReactNode;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  className?: string;
  /** A single input-like element; it receives id / aria attributes automatically. */
  children: ReactElement<Record<string, unknown>>;
}

/** Label + control + hint/error with correct accessibility wiring. */
export function FormField({ label, error, hint, required, className, children }: FormFieldProps) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  const control = isValidElement(children)
    ? cloneElement(children, {
        id: (children.props.id as string | undefined) ?? id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedBy,
      })
    : children;
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label
        htmlFor={(children.props.id as string | undefined) ?? id}
        className="text-xs font-medium"
      >
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </Label>
      <FieldContext.Provider
        value={{
          id: (children.props.id as string | undefined) ?? id,
          describedBy,
          invalid: Boolean(error),
        }}
      >
        {control}
      </FieldContext.Provider>
      {error ? (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
