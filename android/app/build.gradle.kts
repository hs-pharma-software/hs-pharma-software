import java.util.Properties

plugins {
    id("com.android.application")
}

// Release signing: signing/keystore.properties (kept on this computer only, never shared).
val signing = Properties().apply {
    val f = rootProject.file("signing/keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    namespace = "pk.mavin.business"
    compileSdk = 37

    defaultConfig {
        applicationId = "pk.mavin.business"
        minSdk = 24
        targetSdk = 36
        versionCode = 3
        versionName = "1.0.2"
    }

    signingConfigs {
        create("release") {
            if (signing.isNotEmpty()) {
                storeFile = rootProject.file("signing/" + signing.getProperty("storeFile"))
                storePassword = signing.getProperty("storePassword")
                keyAlias = signing.getProperty("keyAlias")
                keyPassword = signing.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (signing.isNotEmpty()) signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    // Google's helper for Trusted Web Activities (launcher, splash, fallback).
    implementation("com.google.androidbrowserhelper:androidbrowserhelper:2.7.4")
}
