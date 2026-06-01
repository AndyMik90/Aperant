import { useState } from 'react';
import { Server, ChevronDown, ChevronRight, HardDrive, Mail, CreditCard, Zap } from 'lucide-react';
import { Badge } from '../../ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '../../ui/collapsible';
import type { ServiceInfo } from '../../../../shared/types';

interface ExternalServicesSectionProps {
  services: ServiceInfo['services'];
}

export function ExternalServicesSection({ services }: ExternalServicesSectionProps) {
  const [expanded, setExpanded] = useState(false);

  if (!services || !Object.values(services).some(arr => arr && arr.length > 0)) {
    return null;
  }

  return (
    <Collapsible
      open={expanded}
      onOpenChange={setExpanded}
      className="border-t border-border pt-3"
    >
      <CollapsibleTrigger className="flex w-full items-center justify-between text-xs font-medium hover:text-foreground">
        <div className="flex items-center gap-2">
          <Server className="h-3 w-3" />
          External Services
        </div>
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-2">
        {services.databases && services.databases.length > 0 && (
          <div>
            <span className="text-xs text-muted-foreground">Databases</span>
            <div className="flex flex-wrap gap-1 mt-1">
              {services.databases.map((db, idx) => (
                <Badge key={idx} variant="secondary" className="text-xs">
                  <HardDrive className="h-3 w-3 me-1" />
                  {db.type || db.client}
                </Badge>
              ))}
            </div>
          </div>
        )}
        {services.email && services.email.length > 0 && (
          <div>
            <span className="text-xs text-muted-foreground">Email</span>
            <div className="flex flex-wrap gap-1 mt-1">
              {services.email.map((email, idx) => (
                <Badge key={idx} variant="secondary" className="text-xs">
                  <Mail className="h-3 w-3 me-1" />
                  {email.provider || email.client}
                </Badge>
              ))}
            </div>
          </div>
        )}
        {services.payments && services.payments.length > 0 && (
          <div>
            <span className="text-xs text-muted-foreground">Payments</span>
            <div className="flex flex-wrap gap-1 mt-1">
              {services.payments.map((payment, idx) => (
                <Badge key={idx} variant="secondary" className="text-xs">
                  <CreditCard className="h-3 w-3 me-1" />
                  {payment.provider || payment.client}
                </Badge>
              ))}
            </div>
          </div>
        )}
        {services.cache && services.cache.length > 0 && (
          <div>
            <span className="text-xs text-muted-foreground">Cache</span>
            <div className="flex flex-wrap gap-1 mt-1">
              {services.cache.map((cache, idx) => (
                <Badge key={idx} variant="secondary" className="text-xs">
                  <Zap className="h-3 w-3 me-1" />
                  {cache.type || cache.client}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
