/**
 * Awareness Service — Orchestrator
 *
 * Wires together CaptureEngine, OCREngine, ContextTracker, Intelligence,
 * SuggestionEngine, ContextGraph, and Analytics into a single service.
 * Implements the Service interface for daemon lifecycle management.
 */

import type { Service, ServiceStatus } from '../daemon/services.ts';
import type { JarvisConfig, AwarenessConfig } from '../config/types.ts';
import type { LLMManager } from '../llm/manager.ts';
import type { DesktopController } from '../actions/app-control/desktop-controller.ts';
import type { AwarenessEvent, LiveContext, DailyReport, Suggestion, SessionSummary, WeeklyReport, BehavioralInsight } from './types.ts';
import type { SuggestionType, SuggestionRow } from './types.ts';

import { CaptureEngine } from './capture-engine.ts';
import { OCREngine } from './ocr-engine.ts';
import { ContextTracker } from './context-tracker.ts';
import { AwarenessIntelligence } from './intelligence.ts';
import { SuggestionEngine } from './suggestion-engine.ts';
import { ContextGraph } from './context-graph.ts';
import { BehaviorAnalytics } from './analytics.ts';
import {
  createCapture,
  getCapturesForSession,
  getSession,
  updateSession,
  updateCaptureRetention,
  markSuggestionDelivered,
  markSuggestionDismissed,
  markSuggestionActedOn,
  getRecentSuggestions,
} from '../vault/awareness.ts';
import { createObservation } from '../vault/observations.ts';
import { getUpcoming } from '../vault/commitments.ts';

export class AwarenessService implements Service {
  name = 'awareness';
  private _status: ServiceStatus = 'stopped';

  private config: AwarenessConfig;
  private captureEngine: CaptureEngine;
  private ocrEngine: OCREngine;
  private contextTracker: ContextTracker;
  private intelligence: AwarenessIntelligence;
  private suggestionEngine: SuggestionEngine;
  private contextGraph: ContextGraph;
  private analytics: BehaviorAnalytics;
  private desktop: DesktopController;
  private llm: LLMManager;
  private eventCallback: ((event: AwarenessEvent) => void) | null;
  private enabled: boolean;

  constructor(
    jarvisConfig: JarvisConfig,
    llm: LLMManager,
    desktop: DesktopController,
    eventCallback?: (event: AwarenessEvent) => void,
    googleAuth?: { isAuthenticated(): boolean; getAccessToken(): Promise<string> } | null
  ) {
    const cfg = jarvisConfig.awareness!;
    this.config = cfg;
    this.llm = llm;
    this.desktop = desktop;
    this.eventCallback = eventCallback ?? null;
    this.enabled = cfg.enabled;

    this.captureEngine = new CaptureEngine(cfg, desktop);
    this.ocrEngine = new OCREngine();
    this.contextTracker = new ContextTracker(cfg);
    this.intelligence = new AwarenessIntelligence(
      llm,
      cfg.cloud_vision_enabled ? cfg.cloud_vision_cooldown_ms : Infinity
    );
    this.suggestionEngine = new SuggestionEngine(cfg.suggestion_rate_limit_ms, {
      googleAuth: googleAuth ?? null,
      getUpcomingCommitments: () => getUpcoming(10).map(c => ({
        what: c.what,
        when_due: c.when_due,
        priority: c.priority,
      })),
    });
    this.contextGraph = new ContextGraph();
    this.analytics = new BehaviorAnalytics(llm);
  }

  async start(): Promise<void> {
    if (!this.enabled) {
      console.log('[Awareness] Disabled by config');
      this._status = 'stopped';
      return;
    }

    this._status = 'starting';

    try {
      // 1. Initialize OCR engine
      await this.ocrEngine.initialize();

      // 2. Wire capture engine event handler
      this.captureEngine.onEvent(async (event) => {
        if (event.type !== 'screen_capture') return;
        await this.processCaptureEvent(event.data as {
          captureId: string;
          pixelChangePct: number;
          imagePath: string;
          imageBuffer: Buffer;
        });
      });

      // 3. Start capture engine
      await this.captureEngine.start();

      this._status = 'running';
      console.log('[Awareness] Service started — capture + OCR + context tracking active');
    } catch (err) {
      this._status = 'error';
      console.error('[Awareness] Failed to start:', err instanceof Error ? err.message : err);
      throw err;
    }
  }

  async stop(): Promise<void> {
    this._status = 'stopping';

    // End current session
    this.contextTracker.endCurrentSession();

    // Stop engines
    await this.captureEngine.stop();
    await this.ocrEngine.shutdown();

    this._status = 'stopped';
    console.log('[Awareness] Service stopped');
  }

  status(): ServiceStatus {
    return this._status;
  }

  // ── Public API ──

  getLiveContext(): LiveContext {
    return this.analytics.getLiveContext(this.contextTracker, this._status === 'running');
  }

  getCurrentSession() {
    return this.contextTracker.getCurrentSession();
  }

  getRecentSuggestionsList(limit?: number, type?: SuggestionType): SuggestionRow[] {
    return getRecentSuggestions(limit, type);
  }

  dismissSuggestion(id: string): void {
    markSuggestionDismissed(id);
  }

  actOnSuggestion(id: string): void {
    markSuggestionActedOn(id);
  }

  async generateReport(date?: string): Promise<DailyReport> {
    return this.analytics.generateDailyReport(date);
  }

  getSessionHistory(limit?: number): SessionSummary[] {
    return this.analytics.getSessionHistory(limit);
  }

  async generateWeeklyReport(weekStart?: string): Promise<WeeklyReport> {
    return this.analytics.generateWeeklyReport(weekStart);
  }

  getBehavioralInsights(days?: number): BehavioralInsight[] {
    return this.analytics.getBehavioralInsights(days);
  }

  toggle(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled && this._status === 'running') {
      this.stop().catch(err =>
        console.error('[Awareness] Error stopping:', err)
      );
    } else if (enabled && this._status === 'stopped') {
      this.start().catch(err =>
        console.error('[Awareness] Error starting:', err)
      );
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  // ── Processing Pipeline ──

  private async processCaptureEvent(data: {
    captureId: string;
    pixelChangePct: number;
    imagePath: string;
    thumbnailPath?: string;
    imageBuffer: Buffer;
  }): Promise<void> {
    try {
      // 1. OCR — extract text from screenshot
      let ocrText = '';
      if (this.ocrEngine.isReady()) {
        const ocr = await this.ocrEngine.extractText(data.imageBuffer);
        ocrText = ocr.text;
      }

      // 2. Get active window title via desktop controller
      let windowTitle: string | undefined;
      try {
        await this.desktop.connect();
        const activeWindow = await this.desktop.getActiveWindow();
        windowTitle = activeWindow?.title;
      } catch { /* sidecar not available */ }

      // 3. Context tracking — detect app changes, stuck states, errors
      const { context, events } = this.contextTracker.processCapture(
        data.captureId,
        ocrText,
        windowTitle
      );

      // 4. Entity linking
      this.contextGraph.linkCaptureToEntities(context);

      // 5. Store capture metadata in DB
      createCapture({
        timestamp: context.timestamp,
        sessionId: context.sessionId,
        imagePath: data.imagePath,
        thumbnailPath: data.thumbnailPath ?? undefined,
        pixelChangePct: data.pixelChangePct,
        ocrText,
        appName: context.appName,
        windowTitle: context.windowTitle,
        url: context.url ?? undefined,
        filePath: context.filePath ?? undefined,
      });

      // 5b. Promote to key_moment retention if significant events fired
      const keyMomentEventTypes = ['error_detected', 'stuck_detected', 'context_changed'];
      if (events.some(e => keyMomentEventTypes.includes(e.type))) {
        try { updateCaptureRetention(data.captureId, 'key_moment'); } catch { /* best-effort */ }
      }

      // 6. Store as observation
      try {
        createObservation('screen_capture', {
          captureId: data.captureId,
          appName: context.appName,
          windowTitle: context.windowTitle,
          ocrPreview: ocrText.slice(0, 200),
        });
      } catch { /* observation storage is best-effort */ }

      // 7. Cloud vision escalation (async, non-blocking)
      let cloudAnalysis: string | undefined;
      if (this.config.cloud_vision_enabled && this.intelligence.shouldEscalateToCloud(context, events)) {
        const base64 = data.imageBuffer.toString('base64');

        // Use specialized struggle analysis when struggle is detected
        const struggleEvent = events.find(e => e.type === 'struggle_detected');
        if (struggleEvent) {
          cloudAnalysis = await this.intelligence.analyzeStruggle(
            base64,
            context,
            String(struggleEvent.data.appCategory ?? 'general'),
            (struggleEvent.data.signals as Array<{ name: string; score: number; detail: string }>) ?? [],
            String(struggleEvent.data.ocrPreview ?? context.ocrText.slice(0, 500))
          );
        } else if (context.isSignificantChange) {
          cloudAnalysis = await this.intelligence.analyzeDelta(
            base64,
            context,
            this.contextTracker.getPreviousContext()
          );
        } else {
          cloudAnalysis = await this.intelligence.analyzeGeneral(base64, context);
        }
      }

      // 8. Suggestion evaluation
      const suggestion = await this.suggestionEngine.evaluate(context, events, cloudAnalysis);
      if (suggestion) {
        // Mark as delivered (will go to chat + voice + channels)
        try { markSuggestionDelivered(suggestion.id, 'websocket'); } catch { /* ignore */ }

        const suggestionEvent: AwarenessEvent = {
          type: 'suggestion_ready',
          data: {
            id: suggestion.id,
            type: suggestion.type,
            title: suggestion.title,
            body: suggestion.body,
          },
          timestamp: Date.now(),
        };
        events.push(suggestionEvent);
      }

      // 9. Emit all events
      for (const event of events) {
        this.eventCallback?.(event);
      }

      // 10. Session topic inference (async, non-blocking)
      const sessionEnd = events.find(e => e.type === 'session_ended');
      if (sessionEnd) {
        this.inferSessionTopic(sessionEnd.data as { sessionId: string; apps: string[] }).catch(err =>
          console.error('[Awareness] Session topic inference failed:', err instanceof Error ? err.message : err)
        );
      }
    } catch (err) {
      console.error('[Awareness] Pipeline error:', err instanceof Error ? err.message : err);
    }
  }

  /**
   * Asynchronously infer topic and summary for a completed session via LLM.
   */
  private async inferSessionTopic(data: { sessionId: string; apps: string[] }): Promise<void> {
    const { sessionId, apps } = data;
    if (!sessionId) return;

    try {
      const session = getSession(sessionId);
      if (!session) return;

      const startedAt = session.started_at;
      const endedAt = session.ended_at ?? Date.now();
      const durationMinutes = Math.round((endedAt - startedAt) / 60000);

      // Only summarize sessions > 2 minutes
      if (durationMinutes < 2) return;

      // Get sample OCR texts from this session's captures
      const captures = getCapturesForSession(sessionId);
      const sampleOcrTexts = captures
        .filter(c => c.ocr_text && c.ocr_text.length > 20)
        .slice(0, 5)
        .map(c => c.ocr_text!);

      if (sampleOcrTexts.length === 0) return;

      const { topic, summary } = await this.intelligence.summarizeSession(
        apps,
        session.capture_count,
        durationMinutes,
        sampleOcrTexts
      );

      updateSession(sessionId, { topic, summary });
      console.log(`[Awareness] Session topic: "${topic}" (${durationMinutes}min, ${apps.join(', ')})`);
    } catch (err) {
      console.error('[Awareness] Topic inference error:', err instanceof Error ? err.message : err);
    }
  }
}
