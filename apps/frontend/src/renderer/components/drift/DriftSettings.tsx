/**
 * DriftSettings Component
 *
 * Settings panel for configuring agent drift monitoring behavior.
 * Allows users to enable/disable drift detection and adjust thresholds.
 */

import * as React from 'react';
import { useEffect } from 'react';
import { useDriftStore, type DriftSettings as DriftSettingsType } from '../../stores/drift-store';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Switch } from '../ui/switch';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Separator } from '../ui/separator';
import { AlertTriangle, Eye, Bell, Shield } from 'lucide-react';

interface DriftSettingsProps {
  projectDir: string;
}

/**
 * Settings panel for agent drift monitoring
 */
export function DriftSettings({ projectDir }: DriftSettingsProps) {
  const settings = useDriftStore((s) => s.settings);
  const settingsLoading = useDriftStore((s) => s.settingsLoading);
  const loadSettings = useDriftStore((s) => s.loadSettings);
  const saveSettings = useDriftStore((s) => s.saveSettings);

  // Load settings on mount
  useEffect(() => {
    if (projectDir) {
      loadSettings(projectDir);
    }
  }, [projectDir, loadSettings]);

  const handleSettingChange = async (key: keyof DriftSettingsType, value: boolean | number) => {
    await saveSettings(projectDir, { [key]: value });
  };

  if (settingsLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Agent Drift Monitoring
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-32 flex items-center justify-center text-muted-foreground">
            Loading settings...
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Shield className="h-4 w-4" />
          Agent Drift Monitoring
        </CardTitle>
        <CardDescription>
          Detect prompt injection, memory poisoning, and behavioral drift by
          comparing agent behavior against a trusted baseline.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Main enable toggle */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="drift-enabled" className="text-sm font-medium">
              Enable Drift Monitoring
            </Label>
            <p className="text-xs text-muted-foreground">
              Track agent behavioral patterns during task execution
            </p>
          </div>
          <Switch
            id="drift-enabled"
            checked={settings.enabled}
            onCheckedChange={(checked) => handleSettingChange('enabled', checked)}
          />
        </div>

        {settings.enabled && (
          <>
            <Separator />

            {/* Alert thresholds */}
            <div className="space-y-4">
              <h4 className="text-sm font-medium flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                Alert Thresholds
              </h4>

              {/* Warning threshold */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm">Warning Threshold</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={10}
                      max={50}
                      step={5}
                      value={(settings.warningThreshold * 100).toFixed(0)}
                      onChange={(e) => {
                        const value = parseInt(e.target.value, 10);
                        if (!isNaN(value) && value >= 10 && value <= 50) {
                          handleSettingChange('warningThreshold', value / 100);
                        }
                      }}
                      className="w-20 h-8 text-sm text-amber-500"
                    />
                    <span className="text-sm text-muted-foreground">%</span>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Drift score above this triggers a warning badge (10-50%)
                </p>
              </div>

              {/* Critical threshold */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm">Critical Threshold</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={30}
                      max={80}
                      step={5}
                      value={(settings.criticalThreshold * 100).toFixed(0)}
                      onChange={(e) => {
                        const value = parseInt(e.target.value, 10);
                        if (!isNaN(value) && value >= 30 && value <= 80) {
                          handleSettingChange('criticalThreshold', value / 100);
                        }
                      }}
                      className="w-20 h-8 text-sm text-red-500"
                    />
                    <span className="text-sm text-muted-foreground">%</span>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Drift score above this triggers a critical alert (30-80%)
                </p>
              </div>
            </div>

            <Separator />

            {/* Display options */}
            <div className="space-y-4">
              <h4 className="text-sm font-medium flex items-center gap-2">
                <Eye className="h-4 w-4" />
                Display Options
              </h4>

              {/* Show badge */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="show-badge" className="text-sm">
                    Show Drift Badge
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Display drift indicator on task cards
                  </p>
                </div>
                <Switch
                  id="show-badge"
                  checked={settings.showBadge}
                  onCheckedChange={(checked) => handleSettingChange('showBadge', checked)}
                />
              </div>

              {/* Show alert banner */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="show-banner" className="text-sm flex items-center gap-1.5">
                    <Bell className="h-3 w-3" />
                    Show Alert Banner
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Display prominent banner for critical drift alerts
                  </p>
                </div>
                <Switch
                  id="show-banner"
                  checked={settings.showAlertBanner}
                  onCheckedChange={(checked) => handleSettingChange('showAlertBanner', checked)}
                />
              </div>
            </div>

            <Separator />

            {/* Info section */}
            <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground space-y-2">
              <p className="font-medium">How Drift Detection Works:</p>
              <ul className="list-disc list-inside space-y-1 ml-1">
                <li>First run creates a trusted baseline from agent behavior</li>
                <li>Subsequent runs are compared against this baseline</li>
                <li>Drift is measured across 7 behavior categories</li>
                <li>High drift may indicate prompt injection or tampering</li>
              </ul>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default DriftSettings;
