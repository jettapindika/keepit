const fs = require('fs');
const path = require('path');
const {
  AndroidConfig,
  createRunOncePlugin,
  withAndroidManifest,
  withAppBuildGradle,
  withDangerousMod,
  withEntitlementsPlist,
  withGradleProperties,
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
          _: 'Latest partner Moment and status on your Home Screen.',
        },
      ],
      modConfig.modResults
    );
    return modConfig;
  });
}

function withAndroidSizeAndAbiOptimizations(config) {
  return withGradleProperties(config, (modConfig) => {
    const setProp = (key, value) => {
      const idx = modConfig.modResults.findIndex(
        (item) => item.type === 'property' && item.key === key
      );
      if (idx >= 0) {
        modConfig.modResults[idx].value = value;
      } else {
        modConfig.modResults.push({ type: 'property', key, value });
      }
    };
    // Target physical 32-bit + 64-bit ARM devices (cuts ~61 MB of desktop Intel x86/x86_64 emulator binaries)
    setProp('reactNativeArchitectures', 'armeabi-v7a,arm64-v8a');
    // Compress native .so libraries inside the APK (cuts ~55% of .so download size)
    setProp('expo.useLegacyPackaging', 'true');
    // Enable resource shrinking alongside R8 minification
    setProp('android.enableShrinkResourcesInReleaseBuilds', 'true');
    // Set targetSdk 35 so Android 12–15 PackageParser (e.g. Samsung Galaxy A05s OneUI)
    // accepts the package while keeping compileSdk 37 required by Expo 58 AndroidX libraries
    setProp('android.targetSdkVersion', '35');
    return modConfig;
  });
}

function withAndroidWidgetResources(config) {
  return withDangerousMod(config, [
    'android',
    async (modConfig) => {
      const projectRoot = modConfig.modRequest.projectRoot;
      const platformProjectRoot = modConfig.modRequest.platformProjectRoot;

      const layoutDir = path.join(platformProjectRoot, 'app', 'src', 'main', 'res', 'layout');
      fs.mkdirSync(layoutDir, { recursive: true });

      const layoutXml = [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android"',
        '  android:layout_width="match_parent"',
        '  android:layout_height="match_parent">',
        '  <ImageView',
        '    android:id="@+id/widget_canvas_image"',
        '    android:layout_width="match_parent"',
        '    android:layout_height="match_parent"',
        '    android:scaleType="fitXY"',
        '    android:contentDescription="@string/keepit_widget_label" />',
        '</FrameLayout>',
        '',
      ].join('\n');

      fs.writeFileSync(path.join(layoutDir, 'keepit_appwidget.xml'), layoutXml, 'utf8');

      const xmlDir = path.join(platformProjectRoot, 'app', 'src', 'main', 'res', 'xml');
      fs.mkdirSync(xmlDir, { recursive: true });

      const providerXml = [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<appwidget-provider xmlns:android="http://schemas.android.com/apk/res/android"',
        '  android:description="@string/keepit_widget_description"',
        '  android:initialLayout="@layout/keepit_appwidget"',
        '  android:previewLayout="@layout/keepit_appwidget"',
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
  nextConfig = withAndroidSizeAndAbiOptimizations(nextConfig);
  nextConfig = withAndroidWidgetResources(nextConfig);
  return nextConfig;
}

module.exports = createRunOncePlugin(withKeepItWidgets, 'with-keepit-widgets', '1.0.0');
