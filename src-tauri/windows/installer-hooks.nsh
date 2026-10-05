; Tauri NSIS installer hooks (bundle.windows.nsis.installerHooks).
;
; Separate shortcut switches for the branded installer shell (installer/). NSIS's /NS
; turns off both the start-menu and the desktop shortcut, so the shell always passes
; /NS and asks for each shortcut it wants:
;   /SLUI-STARTMENU   create the start-menu shortcut
;   /SLUI-DESKTOP     create the desktop shortcut
; Each one is created by the template's own function, so nothing is created and
; removed again. Relies on the Tauri template's $NoShortcutMode variable and its
; CreateOrUpdateStartMenuShortcut / CreateOrUpdateDesktopShortcut functions.
; Without /NS (plain NSIS runs, a future updater) this part does nothing.
;
; scripts/build-installer.mjs includes this file from a generated wrapper that may
; define, as absolute paths on the build machine:
;   SLUI_UNINSTALLER_SOURCE   slui-uninstall.exe, the branded uninstaller; installed next
;                             to slui.exe and registered as UninstallString
;   SLUI_THEME_PACK_SOURCE    a theme pack directory, installed as $INSTDIR\theme-pack.
;                             Not a Tauri resource: registered resources are deleted by
;                             every uninstall, the pack only on /SLUI-THEME-PACK.
; Plain `tauri build` defines neither and keeps the default NSIS uninstaller.
!macro NSIS_HOOK_POSTINSTALL
  ${If} $NoShortcutMode = 1
    StrCpy $NoShortcutMode 0
    ClearErrors
    ${GetOptions} $CMDLINE "/SLUI-STARTMENU" $R9
    ${IfNot} ${Errors}
      Call CreateOrUpdateStartMenuShortcut
    ${EndIf}
    ClearErrors
    ${GetOptions} $CMDLINE "/SLUI-DESKTOP" $R9
    ${IfNot} ${Errors}
      Call CreateOrUpdateDesktopShortcut
    ${EndIf}
    StrCpy $NoShortcutMode 1
  ${EndIf}

  !ifdef SLUI_THEME_PACK_SOURCE
    SetOutPath "$INSTDIR\theme-pack"
    File /r "${SLUI_THEME_PACK_SOURCE}\*.*"
    SetOutPath "$INSTDIR"
  !endif

  !ifdef SLUI_UNINSTALLER_SOURCE
    File "/oname=$INSTDIR\slui-uninstall.exe" "${SLUI_UNINSTALLER_SOURCE}"
    ; The template has just written UninstallString = uninstall.exe.
    WriteRegStr SHCTX "${UNINSTKEY}" "UninstallString" "$\"$INSTDIR\slui-uninstall.exe$\""
    WriteRegStr SHCTX "${UNINSTKEY}" "QuietUninstallString" "$\"$INSTDIR\uninstall.exe$\" /S"
  !endif
!macroend

; Uninstall switches passed by the branded uninstaller (installer/, uninstaller feature):
;   /SLUI-APPDATA      delete the app data, as the wizard's checkbox does
;   /SLUI-THEME-PACK   delete $INSTDIR\theme-pack
;   /SLUI-CLEANUP      the uninstaller runs from a temp copy in $EXEDIR next to the
;                      branded uninstaller's own temp copy; both are locked until their
;                      processes exit, so they are deleted at the next reboot
!macro NSIS_HOOK_PREUNINSTALL
  ClearErrors
  ${GetOptions} $CMDLINE "/SLUI-APPDATA" $R9
  ${IfNot} ${Errors}
    StrCpy $DeleteAppDataCheckboxState 1
  ${EndIf}
!macroend

; Runs after the template has removed the app, its shortcuts and the uninstall entry.
; Not in update mode: the next install overwrites the files.
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    ; Also removes a copy orphaned by a plain-NSIS build installed over a branded one.
    Delete "$INSTDIR\slui-uninstall.exe"
    ClearErrors
    ${GetOptions} $CMDLINE "/SLUI-THEME-PACK" $R9
    ${IfNot} ${Errors}
      RMDir /r "$INSTDIR\theme-pack"
    ${EndIf}
    ; The template's RMDir ran while these files were still there.
    RMDir "$INSTDIR"

    ClearErrors
    ${GetOptions} $CMDLINE "/SLUI-CLEANUP" $R9
    ${IfNot} ${Errors}
    ${AndIf} $EXEDIR != $INSTDIR
      Delete /REBOOTOK "$EXEDIR\slui-uninstall.exe"
      Delete /REBOOTOK "$EXEDIR\uninstall.exe"
      RMDir /REBOOTOK "$EXEDIR"
    ${EndIf}
  ${EndIf}
!macroend
