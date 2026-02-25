import { CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react';
import type { IdeationTypeState } from '../../stores/ideation-store';

interface TypeStateIconProps {
  state: IdeationTypeState;
}

export function TypeStateIcon({ state }: TypeStateIconProps) {
  switch (state) {
    case 'completed':
      return <CheckCircle2 className="h-4 w-4 text-success" />;
    case 'failed':
      return <XCircle className="h-4 w-4 text-destructive" />;
    case 'generating':
      return <Loader2 className="h-4 w-4 text-primary animate-spin" />;
    default:
      return <Circle className="h-4 w-4 text-muted-foreground" />;
  }
}
