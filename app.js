/**
 * VeriCore Live v4.0
 * Улучшенная версия без ограничений sandbox
 */

(function() {
  'use strict';

  // Конфигурация
  const CONFIG = window.VERICORE_CONFIG || {
    API_BASE_URL: 'https://your-worker.workers.dev',
    APP_MODE: 'live',
    CLIENT_VERSION: 'web-v4.0'
  };

  // DOM элементы
  const $ = (id) => document.getElementById(id);
  const form = $('verifyForm');
  const ssnInput = $('ssn');
  const dobInput = $('dob');
  const fullNameInput = $('fullName');
  const emailInput = $('email');
  const selfCheck = $('selfCheck');
  const consentAccepted = $('consentAccepted');
  const dataRetention = $('dataRetention');
  const submitBtn = $('submitBtn');
  const errorBanner = $('errorBanner');
  const resultPanel = $('resultPanel');
  const resultContent = $('resultContent');
  const resultBadge = $('resultBadge');
  const modeIndicator = $('modeIndicator');

  // Инициализация
  function init() {
    initTheme();
    initSSNMasking();
    initEventListeners();
    updateModeIndicator();
    
    // Очистка полей при загрузке (безопасность)
    clearSensitiveFields();
    
    console.log('[VeriCore] Live mode initialized');
  }

  // Очистка чувствительных полей
  function clearSensitiveFields() {
    ssnInput.value = '';
    fullNameInput.value = '';
    dobInput.value = '';
    emailInput.value = '';
  }

  // Инициализация темы
  function initTheme() {
    const savedTheme = localStorage.getItem('vericore-theme') || 'dark';
    document.body.setAttribute('data-theme', savedTheme);
    
    $('themeToggle')?.addEventListener('click', () => {
      const current = document.body.getAttribute('data-theme');
      const next = current === 'dark' ? 'light' : 'dark';
      document.body.setAttribute('data-theme', next);
      localStorage.setItem('vericore-theme', next);
    });
  }

  // Маскирование и автоформатирование SSN
  function initSSNMasking() {
    ssnInput.addEventListener('input', (e) => {
      let value = e.target.value.replace(/\
