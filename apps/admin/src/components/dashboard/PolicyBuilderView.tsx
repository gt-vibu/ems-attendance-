/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, Terminal, ScrollText, Check, Plus, Trash2, Cpu, FileJson, Play } from 'lucide-react';
import { INITIAL_RULES } from '../../data';
import { PolicyRule } from '../../types';

export default function PolicyBuilderView() {
  const [rules, setRules] = useState<PolicyRule[]>(INITIAL_RULES);
  const [nlInput, setNlInput] = useState('');
  const [translating, setTranslating] = useState(false);
  const [activeJsonIndex, setActiveJsonIndex] = useState<number | null>(0);

  const templates = [
    {
      prompt: 'Allow a 15-minute grace period for the engineering shift. Any arrival after that logs as late and fires a Slack notification to Supervisor Ken.',
      rule: {
        id: `r-gen-${Date.now()}`,
        category: 'GRACE_PERIOD' as const,
        name: 'Engineering Shift Grace Allowance',
        description: 'Tolerates maximum 15-minute checkout offsets for specific engineering team schedules.',
        condition: 'shiftOffsetMinutes > 15',
        action: 'logStatus(LATE) and emitSlackWebhook(SUPERVISOR_KEN)',
        active: true
      }
    },
    {
      prompt: 'Two 20-minute paid breaks. If the employee stays out of the geofence for more than 25 minutes, flag the session as a medium anomaly.',
      rule: {
        id: `r-gen-${Date.now() + 1}`,
        category: 'BREAKS' as const,
        name: 'Paid Break Telemetry Cap',
        description: 'Tolerates maximum 25-minute absolute offline exit bounds before flagging gaps.',
        condition: 'outOfOfficeMinutes > 25',
        action: 'flagSession(NEEDS_REVIEW, AnomalySeverity.MEDIUM)',
        active: true
      }
    },
    {
      prompt: 'Enforce dual-factor checkout. Require device identity verification and office Wi-Fi MAC handshake. Fallback to manager bypass if the device check fails.',
      rule: {
        id: `r-gen-${Date.now() + 2}`,
        category: 'BIOMETRIC' as const,
        name: 'Dual-Factor Checkout Enforcer',
        description: 'Strict mandatory checkout pipeline requiring WebAuthn device verification and connected BSSID logs.',
        condition: '!deviceIdentityVerified || !wifiSsidMatches',
        action: 'blockCheckout() or invokeManagerApproval()',
        active: true
      }
    }
  ];

  const handleTemplateClick = (promptText: string) => {
    setNlInput(promptText);
  };

  const executeTranslation = () => {
    if (!nlInput.trim()) return;
    setTranslating(true);

    // Find if it matches one of our predefined templates to generate realistic outputs
    const match = templates.find(t => nlInput.includes(t.prompt.substring(0, 10))) || {
      rule: {
        id: `r-gen-${Date.now()}`,
        category: 'GEOFENCE' as const,
        name: 'Custom NL Security Boundary',
        description: 'Dynamically generated geofencing validation trigger from plain English prompt.',
        condition: 'deviceLocation.distanceToBranch > 50',
        action: 'flagSession(NEEDS_REVIEW, AnomalySeverity.HIGH)',
        active: true
      }
    };

    setTimeout(() => {
      setRules(prev => [...prev, match.rule]);
      setTranslating(false);
      setNlInput('');
      // Open the JSON of the newly created rule
      setActiveJsonIndex(rules.length);
    }, 2000);
  };

  const handleToggleRule = (index: number) => {
    setRules(prev => {
      const updated = [...prev];
      updated[index].active = !updated[index].active;
      return updated;
    });
  };

  const handleDeleteRule = (index: number) => {
    setRules(prev => prev.filter((_, i) => i !== index));
    if (activeJsonIndex === index) {
      setActiveJsonIndex(null);
    }
  };

  return (
    <div className="bg-white/80 border border-slate-200/50 rounded-3xl p-6 shadow-xl max-w-5xl mx-auto backdrop-blur-md">
      
      {/* Container Header */}
      <div className="flex justify-between items-center mb-6 pb-3 border-b border-slate-200/40">
        <div>
          <h4 className="font-sans font-bold text-sm tracking-tight text-slate-950 uppercase flex items-center gap-1.5">
            <Sparkles className="text-indigo-500 w-4.5 h-4.5 animate-pulse" />
            AI Policy Builder & Rule Engine
          </h4>
          <span className="font-mono text-[9px] tracking-widest text-slate-400 font-semibold uppercase">
            Compile English specifications into validated JSON policies (v2.4.1)
          </span>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-800 border border-indigo-100 text-[10px] font-mono font-bold">
          <Terminal className="w-3 h-3" />
          LLM_TRANSLATION_CORE
        </div>
      </div>

      <div className="grid lg:grid-cols-12 gap-8">
        
        {/* Left Column: Input and templates */}
        <div className="lg:col-span-7 space-y-6">
          <div className="space-y-2">
            <label className="font-mono text-[10px] tracking-wider text-slate-400 font-bold uppercase block">
              Describe attendance policy in plain english
            </label>
            <div className="relative">
              <textarea
                placeholder="Ex. Allow 15 minutes of late grace for morning shift employees..."
                className="w-full h-24 bg-slate-50 border border-slate-200 focus:border-slate-400 focus:outline-none rounded-2xl p-4 text-xs text-slate-700 placeholder-slate-400 resize-none font-sans"
                value={nlInput}
                onChange={(e) => setNlInput(e.target.value)}
              />
              <button
                onClick={executeTranslation}
                disabled={translating || !nlInput.trim()}
                id="btn-execute-translation"
                className={`absolute bottom-3 right-3 flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[10px] font-bold tracking-wide shadow-md transition-all duration-300 ${
                  translating || !nlInput.trim()
                    ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                    : 'bg-indigo-600 text-white hover:bg-indigo-700 hover:scale-[1.03]'
                }`}
              >
                <Sparkles className="w-3 h-3 animate-pulse" />
                {translating ? 'Compiling...' : 'Compile Rules'}
              </button>
            </div>
          </div>

          {/* Quick templates / prompts */}
          <div className="space-y-2">
            <span className="font-mono text-[9px] tracking-wider text-slate-400 font-bold uppercase block">
              Suggested policy presets (click to load)
            </span>
            <div className="space-y-1.5">
              {templates.map((tpl, i) => (
                <button
                  key={i}
                  id={`preset-tpl-btn-${i}`}
                  onClick={() => handleTemplateClick(tpl.prompt)}
                  className="w-full text-left p-2.5 rounded-xl border border-slate-150 bg-white/50 hover:bg-white text-[11px] font-sans text-slate-600 hover:text-slate-900 transition-all duration-300 flex gap-2 items-center"
                >
                  <Cpu className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                  <span className="truncate">{tpl.prompt}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Rule ledger / listings */}
          <div className="space-y-3">
            <span className="font-mono text-[9px] tracking-wider text-slate-400 font-bold uppercase block border-b border-slate-100 pb-1">
              Active compiled policy rules
            </span>
            <div className="space-y-2.5">
              {rules.map((rule, idx) => (
                <div
                  key={rule.id}
                  onClick={() => setActiveJsonIndex(idx)}
                  className={`p-3.5 rounded-2xl border transition-all duration-300 flex items-start justify-between cursor-pointer ${
                    activeJsonIndex === idx
                      ? 'bg-indigo-50/10 border-indigo-200'
                      : 'bg-white border-slate-200/60'
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[9px] uppercase font-bold text-slate-400">
                        {rule.category}
                      </span>
                      <h5 className="font-sans font-bold text-xs text-slate-900">{rule.name}</h5>
                    </div>
                    <p className="font-sans text-[11px] text-slate-500 max-w-md">{rule.description}</p>
                  </div>
                  
                  {/* Status Toggle & Delete button */}
                  <div className="flex items-center gap-3 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => handleToggleRule(idx)}
                      id={`rule-toggle-btn-${idx}`}
                      className={`relative w-9 h-5 rounded-full transition-colors duration-300 cursor-pointer ${
                        rule.active ? 'bg-indigo-600' : 'bg-slate-200'
                      }`}
                    >
                      <motion.div
                        className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm"
                        animate={{ x: rule.active ? 16 : 0 }}
                        transition={{ type: 'spring', stiffness: 350, damping: 25 }}
                      />
                    </button>
                    <button
                      onClick={() => handleDeleteRule(idx)}
                      id={`rule-delete-btn-${idx}`}
                      className="text-slate-400 hover:text-rose-500 transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column: Code inspector */}
        <div className="lg:col-span-5 flex flex-col h-full">
          <div className="flex-1 border border-slate-200 rounded-3xl bg-slate-950 text-slate-300 p-5 font-mono text-xs overflow-hidden flex flex-col shadow-inner relative">
            <div className="absolute top-0 right-0 p-3 text-[8px] text-slate-500 tracking-widest uppercase font-bold">
              POLICY_SCHEMA_JSON
            </div>
            
            <div className="flex items-center gap-1.5 text-slate-400 border-b border-slate-800 pb-3 mb-4 shrink-0">
              <FileJson className="w-4 h-4 text-indigo-400" />
              <span>policyVersion: v2.4.1</span>
            </div>

            {/* Animation transition states */}
            <AnimatePresence mode="wait">
              {translating ? (
                <motion.div
                  key="translating"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex-1 flex flex-col items-center justify-center text-center space-y-3"
                >
                  <Cpu className="w-8 h-8 text-indigo-400 animate-spin" />
                  <div className="space-y-1">
                    <p className="font-bold text-white text-xs">Translating English Statement...</p>
                    <p className="text-[10px] text-slate-500">Mapping tokens into conditional rule actions</p>
                  </div>
                </motion.div>
              ) : activeJsonIndex !== null && rules[activeJsonIndex] ? (
                <motion.div
                  key="json-view"
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex-1 overflow-auto text-[11px] leading-relaxed text-indigo-200"
                >
                  <pre className="whitespace-pre-wrap font-mono">
                    {`{
  "ruleId": "${rules[activeJsonIndex].id}",
  "ruleCategory": "${rules[activeJsonIndex].category}",
  "ruleName": "${rules[activeJsonIndex].name}",
  "triggerCondition": {
    "evaluation": "${rules[activeJsonIndex].condition}"
  },
  "executionPipeline": {
    "actions": [
      "${rules[activeJsonIndex].action.split(' and ')[0]}"${rules[activeJsonIndex].action.includes(' and ') ? ',\n      "' + rules[activeJsonIndex].action.split(' and ')[1] + '"' : ''}
    ]
  },
  "metadata": {
    "source": "AI_NLP_BUILDER",
    "status": "${rules[activeJsonIndex].active ? 'ACTIVE' : 'INACTIVE'}"
  }
}`}
                  </pre>
                </motion.div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-center text-slate-500">
                  <ScrollText className="w-8 h-8 text-slate-700 mb-2" />
                  <p className="text-xs">No active rule selected.</p>
                  <p className="text-[10px] text-slate-600">Select a compiled policy card to inspect its JSON schema definition.</p>
                </div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}
