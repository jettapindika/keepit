const fs = require('fs');
const path = require('path');
const {
  AndroidConfig,
  createRunOncePlugin,
  withAndroidManifest,
  withAppBuildGradle,
  withDangerousMod,
  withEntitlementsPlist,
  withStringsXml,
} = require('expo/config-plugins');

const APP_GROUP_ID = 'group.com.keepit.shared';
const ANDROID_RECEIVER_NAME = 'com.keepit.app.widget.KeepItGlanceWidgetReceiver';

function withIosWidgetAppGroup(config, appGroupId) {
  return withEntitlementsPlist(config, (modConfig) => {
    const existingGroups = Array.isArray(
      modConfig.modResults['com.apple.security.application-groups']
    )
      ? modConfig.modResults['com.apple.security.application-groups']
      : [];

    if (!existingGroups.includes(appGroupId)) {
      modConfig.modResults['com.apple.security.application-groups'] = [
        ...existingGroups,
        appGroupId,
      ];
    }

    return modConfig;
  });
}

function withIosWidgetTargetFiles(config, appGroupId) {
  return withDangerousMod(config, [
    'ios',
    async (modConfig) => {
      const projectRoot = modConfig.modRequest.projectRoot;
      const platformProjectRoot = modConfig.modRequest.platformProjectRoot;
      const sourceSwift = path.join(projectRoot, 'targets', 'ios-widget', 'KeepItWidget.swift');
      const widgetTargetDir = path.join(platformProjectRoot, 'KeepItWidget');

      if (fs.existsSync(sourceSwift)) {
        fs.mkdirSync(widgetTargetDir, { recursive: true });
        fs.copyFileSync(sourceSwift, path.join(widgetTargetDir, 'KeepItWidget.swift'));

        const entitlementsContent = [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
          '<plist version="1.0">',
          '<dict>',
          '  <key>com.apple.security.application-groups</key>',
          '  <array>',
          `    <string>${appGroupId}</string>`,
          '  </array>',
          '</dict>',
          '</plist>',
          '',
        ].join('\n');

        fs.writeFileSync(
          path.join(widgetTargetDir, 'KeepItWidget.entitlements'),
          entitlementsContent,
          'utf8'
        );
      }

      return modConfig;
    },
  ]);
}

function withAndroidWidgetManifest(config) {
  return withAndroidManifest(config, (modConfig) => {
    const mainApplication = AndroidConfig.Manifest.getMainApplicationOrThrow(
      modConfig.modResults
    );

    mainApplication.receiver = mainApplication.receiver || [];

    const alreadyRegistered = mainApplication.receiver.some(
      (entry) => entry?.$?.['android:name'] === ANDROID_RECEIVER_NAME
    );

    if (!alreadyRegistered) {
      mainApplication.receiver.push({
        $: {
          'android:name': ANDROID_RECEIVER_NAME,
          'android:exported': 'true',
          'android:label': '@string/keepit_widget_label',
        },
        'intent-filter': [
          {
            action: [
              {
                $: {
                  'android:name': 'android.appwidget.action.APPWIDGET_UPDATE',
                },
              },
            ],
          },
        ],
        'meta-data': [
          {
            $: {
              'android:name': 'android.appwidget.provider',
              'android:resource': '@xml/keepit_widget_info',
            },
          },
        ],
      });
    }

    return modConfig;
  });
}

function withAndroidWidgetStrings(config) {
  return withStringsXml(config, (modConfig) => {
    modConfig.modResults = AndroidConfig.Strings.setStringItem(
      [
        {
          $: { name: 'keepit_widget_label', translatable: 'false' },
          _: 'KeepIt Moment & Status',
        },
        {
          $: { name: 'keepit_widget_description', translatable: 'false' },
          _: "Shows your partner's latest daily Moment and live status on your Home Screen.",
        },
      ],
      modConfig.modResults
    );
    return modConfig;
  });
}

function withAndroidGlanceDependencies(config) {
  return withAppBuildGradle(config, (modConfig) => {
    if (modConfig.modResults.language === 'groovy') {
      const glanceDependency = 'implementation("androidx.glance:glance-appwidget:1.1.1")';
      if (!modConfig.modResults.contents.includes('androidx.glance:glance-appwidget')) {
        modConfig.modResults.contents = modConfig.modResults.contents.replace(
          /dependencies\s*\{/,
          `dependencies {\n    ${glanceDependency}`
        );
      }
    }
    return modConfig;
  });
}

function withAndroidWidgetResources(config) {
  return withDangerousMod(config, [
    'android',
    async (modConfig) => {
      const projectRoot = modConfig.modRequest.projectRoot;
      const platformProjectRoot = modConfig.modRequest.platformProjectRoot;

      const xmlDir = path.join(platformProjectRoot, 'app', 'src', 'main', 'res', 'xml');
      fs.mkdirSync(xmlDir, { recursive: true });

      const providerXml = [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<appwidget-provider xmlns:android="http://schemas.android.com/apk/res/android"',
        '  android:description="@string/keepit_widget_description"',
        '  android:minWidth="110dp"',
        '  android:minHeight="110dp"',
        '  android:targetCellWidth="2"',
        '  android:targetCellHeight="2"',
        '  android:minResizeWidth="110dp"',
        '  android:minResizeHeight="110dp"',
        '  android:maxResizeWidth="320dp"',
        '  android:maxResizeHeight="180dp"',
        '  android:resizeMode="horizontal|vertical"',
        '  android:updatePeriodMillis="1800000"',
        '  android:widgetCategory="home_screen" />',
        '',
      ].join('\n');

      fs.writeFileSync(path.join(xmlDir, 'keepit_widget_info.xml'), providerXml, 'utf8');

      const sourceKotlin = path.join(
        projectRoot,
        'targets',
        'android-widget',
        'KeepItGlanceWidget.kt'
      );
      if (fs.existsSync(sourceKotlin)) {
        const destKotlinDir = path.join(
          platformProjectRoot,
          'app',
          'src',
          'main',
          'java',
          'com',
          'keepit',
          'app',
          'widget'
        );
        fs.mkdirSync(destKotlinDir, { recursive: true });
        fs.copyFileSync(sourceKotlin, path.join(destKotlinDir, 'KeepItGlanceWidget.kt'));
      }

      return modConfig;
    },
  ]);
}

function withKeepItWidgets(config, props = {}) {
  const appGroupId = props.appGroupId || APP_GROUP_ID;

  let nextConfig = config;
  nextConfig = withIosWidgetAppGroup(nextConfig, appGroupId);
  nextConfig = withIosWidgetTargetFiles(nextConfig, appGroupId);
  nextConfig = withAndroidWidgetStrings(nextConfig);
  nextConfig = withAndroidWidgetManifest(nextConfig);
  nextConfig = withAndroidGlanceDependencies(nextConfig);
  nextConfig = withAndroidWidgetResources(nextConfig);
  return nextConfig;
}

module.exports = createRunOncePlugin(withKeepItWidgets, 'with-keepit-widgets', '1.0.0');
