import { createContext, useContext } from 'react';

/**
 * Accessibility wiring for composite controls. FormField publishes the id its <label>
 * points at; controls that are not the direct child (e.g. a Select inside a react-hook-form
 * Controller) read it so the label still names them.
 */
export interface FieldA11y {
  id: string;
  describedBy?: string;
  invalid?: boolean;
}

export const FieldContext = createContext<FieldA11y | null>(null);

export function useFieldA11y(): FieldA11y | null {
  return useContext(FieldContext);
}
