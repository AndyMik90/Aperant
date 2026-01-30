/**
 * Settings Routes
 *
 * HTTP endpoints for app settings and profiles.
 */

import type { Router } from 'express';
import type { SettingsService } from '../services/settings-service.js';

export function setupSettingsRoutes(router: Router, settingsService: SettingsService): void {
  // Get app settings
  router.get('/settings', async (_req, res) => {
    try {
      const settings = await settingsService.getSettings();
      res.json({ success: true, data: settings });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Update app settings
  router.patch('/settings', async (req, res) => {
    try {
      const settings = await settingsService.updateSettings(req.body);
      res.json({ success: true, data: settings });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Get app version
  router.get('/version', async (_req, res) => {
    res.json({
      success: true,
      data: settingsService.getAppVersion()
    });
  });

  // List API profiles
  router.get('/profiles', async (_req, res) => {
    try {
      const profiles = await settingsService.getProfiles();
      res.json({ success: true, data: profiles });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Add API profile
  router.post('/profiles', async (req, res) => {
    try {
      const { name, provider, apiKey, baseUrl, model, isDefault } = req.body;
      if (!name || !provider) {
        return res.status(400).json({ success: false, error: 'Name and provider are required' });
      }

      const profile = await settingsService.addProfile({
        name,
        provider,
        apiKey,
        baseUrl,
        model,
        isDefault
      });
      res.json({ success: true, data: profile });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Update API profile
  router.patch('/profiles/:id', async (req, res) => {
    try {
      const profile = await settingsService.updateProfile(req.params.id, req.body);
      if (!profile) {
        return res.status(404).json({ success: false, error: 'Profile not found' });
      }
      res.json({ success: true, data: profile });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Delete API profile
  router.delete('/profiles/:id', async (req, res) => {
    try {
      const deleted = await settingsService.deleteProfile(req.params.id);
      if (!deleted) {
        return res.status(404).json({ success: false, error: 'Profile not found' });
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  console.log('[Routes] Settings routes initialized');
}
