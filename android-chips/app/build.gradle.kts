plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Dirección del panel de admin que abre la app. Se puede cambiar al compilar:
//   gradlew assembleDebug -PpanelUrl=https://otro-dominio/admin.html
val panelUrl: String = (project.findProperty("panelUrl") as String?) ?: "https://next-tap.tech/admin.html"

// La carpeta Documents se sincroniza/indexa y en Windows bloquea archivos de build
// ("Unable to delete directory"): la compilación sale a una carpeta local aparte.
layout.buildDirectory.set(file(System.getenv("LOCALAPPDATA") + "/NextTapChipsBuild/app"))

android {
    namespace = "tech.nexttap.chips"
    compileSdk = 34

    defaultConfig {
        applicationId = "tech.nexttap.chips"
        minSdk = 26
        targetSdk = 34
        versionCode = 2
        versionName = "1.1"
        buildConfigField("String", "PANEL_URL", "\"$panelUrl\"")
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    testImplementation("junit:junit:4.13.2")
}
