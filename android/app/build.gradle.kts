plugins {
    id("com.android.application")
}

val appId = providers.gradleProperty("appId").get()
val hostName = providers.gradleProperty("hostName").get()

android {
    namespace = "com.examprepai.twa"
    compileSdk = 36

    defaultConfig {
        applicationId = appId
        minSdk = 24
        targetSdk = 36
        versionCode = providers.gradleProperty("versionCode").get().toInt()
        versionName = providers.gradleProperty("versionName").get()

        // F131: everything the manifest needs to know about the web app, from gradle.properties.
        manifestPlaceholders["hostName"] = hostName
        manifestPlaceholders["launchUrl"] = "https://$hostName/?source=android"
        // The app's half of Digital Asset Links (the manifest's asset_statements meta-data).
        resValue(
            "string",
            "asset_statements",
            "[{\\\"relation\\\": [\\\"delegate_permission/common.handle_all_urls\\\"], " +
                "\\\"target\\\": {\\\"namespace\\\": \\\"web\\\", \\\"site\\\": \\\"https://$hostName\\\"}}]",
        )
    }

    // Release signing comes from CI secrets only (.github/workflows/android.yml); the keystore
    // itself never enters the repo. Without them a release build is simply left unsigned.
    val keystorePath = System.getenv("ANDROID_KEYSTORE_PATH")
    signingConfigs {
        if (keystorePath != null) {
            create("release") {
                storeFile = file(keystorePath)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
            if (keystorePath != null) signingConfig = signingConfigs.getByName("release")
        }
    }

    buildFeatures {
        resValues = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("com.google.androidbrowserhelper:androidbrowserhelper:2.7.3")
}
