/**
 * Label - Accessible label for form controls
 *
 * @see https://ui.shadcn.com/docs/components/label
 */

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

/* -- Variants ------------------------------------------------------------ */

const labelVariants = cva(
  'text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70'
);

/* -- Components ----------------------------------------------------------- */

export interface LabelProps
  extends React.LabelHTMLAttributes<HTMLLabelElement>,
    VariantProps<typeof labelVariants> {}

const Label = React.forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, ...props }, ref) => (
    <label ref={ref} className={cn(labelVariants(), className)} {...props} />
  )
);
Label.displayName = 'Label';

/* -- Exports -------------------------------------------------------------- */

export { Label };
