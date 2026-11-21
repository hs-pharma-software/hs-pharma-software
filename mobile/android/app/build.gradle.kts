import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// Release signing: the MAVIN Business key (the same key as the current app, so
// installed phones update in place). Kept outside this repository, in
// D:\Pharmacy\mavin-android\signing (or MAVIN_SIGNING_DIR); never committed.
val signingDir = file(System.getenv("MAVIN_SIGNING_DIR") ?: "${rootDir}/../../../mavin-android/signing")
val signing = Properties().apply {
    val f = File(signingDir, "keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    namespace = "pk.mavin.business"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // The same application as the current MAVIN Business app (pk.mavin.business).
        applicationId = "pk.mavin.business"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        // Android 7.0, as the current app.
        minSdk = maxOf(24, flutter.minSdkVersion)
        targetSdk = flutter.targetSdkVersion
        // Uses the version code from pubspec.yaml. When using split APKs, 1000 * ABI_VERSION
        // is added automatically by Flutter. (https://developer.android.com/studio/build/configure-apk-splits#configure-APK-versions)
        // You can force using the value of versionCode by specifying the `-P force-version-code-ignoring-abi=true`
        // flag during build.
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        create("release") {
            if (signing.isNotEmpty()) {
                storeFile = File(signingDir, signing.getProperty("storeFile"))
                storePassword = signing.getProperty("storePassword")
                keyAlias = signing.getProperty("keyAlias")
                keyPassword = signing.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            // Without the key on this computer a release build is signed with the debug key and cannot update installed phones.
            signingConfig = if (signing.isNotEmpty()) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
