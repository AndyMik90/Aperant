import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bell, Check, CheckCheck, Trash2, X, AlertTriangle, Info, CheckCircle2 } from 'lucide-react';
import { Button } from './ui/button';
import { ScrollArea } from './ui/scroll-area';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from './ui/popover';
import { cn } from '../lib/utils';
import {
  useNotificationStore,
  groupNotificationsByTime,
  formatNotificationTime,
  type Notification,
  type NotificationType,
} from '../stores/notification-store';

/**
 * UX-1: Notification Center component
 *
 * Shows a bell icon with unread count badge.
 * Clicking opens a popover with grouped notifications.
 */
export function NotificationCenter() {
  const { t } = useTranslation(['common']);
  const [open, setOpen] = useState(false);

  const notifications = useNotificationStore((state) => state.notifications);
  const unreadCount = useNotificationStore((state) => state.unreadCount);
  const markAllAsRead = useNotificationStore((state) => state.markAllAsRead);
  const clearAll = useNotificationStore((state) => state.clearAll);

  const grouped = groupNotificationsByTime(notifications);
  const hasNotifications = notifications.length > 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-9 w-9"
          aria-label={t('notifications.title', { defaultValue: 'Notifications' })}
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 p-0"
        align="end"
        sideOffset={8}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="font-semibold">
            {t('notifications.title', { defaultValue: 'Notifications' })}
            {unreadCount > 0 && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                ({unreadCount})
              </span>
            )}
          </h3>
          {hasNotifications && (
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={markAllAsRead}
                title={t('notifications.markAllRead', { defaultValue: 'Mark all read' })}
              >
                <CheckCheck className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                onClick={clearAll}
                title={t('notifications.clearAll', { defaultValue: 'Clear all' })}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>

        {/* Notification list */}
        <ScrollArea className="max-h-[400px]">
          {!hasNotifications ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <Bell className="h-8 w-8 mb-2 opacity-50" />
              <p className="text-sm">{t('notifications.empty', { defaultValue: 'No notifications' })}</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {grouped.justNow.length > 0 && (
                <NotificationGroup
                  title={t('notifications.justNow', { defaultValue: 'Just now' })}
                  notifications={grouped.justNow}
                />
              )}
              {grouped.earlierToday.length > 0 && (
                <NotificationGroup
                  title={t('notifications.earlierToday', { defaultValue: 'Earlier today' })}
                  notifications={grouped.earlierToday}
                />
              )}
              {grouped.yesterday.length > 0 && (
                <NotificationGroup
                  title={t('notifications.yesterday', { defaultValue: 'Yesterday' })}
                  notifications={grouped.yesterday}
                />
              )}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

interface NotificationGroupProps {
  title: string;
  notifications: Notification[];
}

function NotificationGroup({ title, notifications }: NotificationGroupProps) {
  return (
    <div className="px-4 py-2">
      <h4 className="text-xs font-medium text-muted-foreground mb-2">{title}</h4>
      <div className="space-y-2">
        {notifications.map((notification) => (
          <NotificationItem key={notification.id} notification={notification} />
        ))}
      </div>
    </div>
  );
}

interface NotificationItemProps {
  notification: Notification;
}

function NotificationItem({ notification }: NotificationItemProps) {
  const markAsRead = useNotificationStore((state) => state.markAsRead);
  const removeNotification = useNotificationStore((state) => state.removeNotification);

  const Icon = getNotificationIcon(notification.type);

  return (
    <div
      className={cn(
        'group flex items-start gap-3 rounded-lg p-2 transition-colors',
        'hover:bg-muted/50',
        !notification.read && 'bg-muted/30'
      )}
      onClick={() => markAsRead(notification.id)}
    >
      <div className={cn('mt-0.5', getNotificationIconColor(notification.type))}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <p className={cn('text-sm', !notification.read && 'font-medium')}>
          {notification.title}
        </p>
        {notification.message && (
          <p className="text-xs text-muted-foreground truncate">
            {notification.message}
          </p>
        )}
        <p className="text-xs text-muted-foreground mt-0.5">
          {formatNotificationTime(notification.timestamp)}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={(e) => {
          e.stopPropagation();
          removeNotification(notification.id);
        }}
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}

function getNotificationIcon(type: NotificationType) {
  switch (type) {
    case 'success':
      return CheckCircle2;
    case 'warning':
      return AlertTriangle;
    case 'error':
      return AlertTriangle;
    case 'info':
    default:
      return Info;
  }
}

function getNotificationIconColor(type: NotificationType): string {
  switch (type) {
    case 'success':
      return 'text-green-500';
    case 'warning':
      return 'text-yellow-500';
    case 'error':
      return 'text-red-500';
    case 'info':
    default:
      return 'text-blue-500';
  }
}
