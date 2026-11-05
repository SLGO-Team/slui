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

  ; Builds before 0.12 had no bundle publisher, so the template's install-location key was
  ; Software\slui\SLUI (the identifier's middle part). Since the publisher is SLGO Team that key
  ; is Software\SLGO Team\SLUI, written above; the old one only held the install directory,
  ; which the uninstall entry's InstallLocation still records. Remove it so it does not linger.
  !if "${MANUFACTURER}" != "slui"
    DeleteRegKey SHCTX "Software\slui\${PRODUCTNAME}"
    DeleteRegKey /ifempty SHCTX "Software\slui"
    DeleteRegKey /ifempty HKCU "Software\slui\${PRODUCTNAME}"
    DeleteRegKey /ifempty HKCU "Software\slui"
  !endif

  ; Apps & features size: the template counted its own files and uninstall.exe only,
  ; before the theme pack and slui-uninstall.exe above were written.
  Push $0
  Push $1
  Push $2
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD SHCTX "${UNINSTKEY}" "EstimatedSize" "$0"
  Pop $2
  Pop $1
  Pop $0
!macroend

; The template's own uninstall wizard (uninstall.exe run directly) has a "delete app data"
; check box. The template deletes $APPDATA / $LOCALAPPDATA in this elevated process, which
; are the folders of the account that approved UAC, not the invoking user's when a standard
; user typed an administrator's password. The hooks take the check box over: the template
; deletes nothing, and POSTUNINSTALL deletes the folders as the desktop's user.
Var SluiDeleteUserData

!macro NSIS_HOOK_PREUNINSTALL
  StrCpy $SluiDeleteUserData 0
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    StrCpy $DeleteAppDataCheckboxState 0
    StrCpy $SluiDeleteUserData 1
  ${EndIf}
!macroend

; Uninstall switches passed by the branded uninstaller (installer/, uninstaller feature):
;   /SLUI-THEME-PACK   delete $INSTDIR\theme-pack
;   /SLUI-CLEANUP      the uninstaller runs from a temp copy in $EXEDIR next to the
;                      branded uninstaller's own temp copy; both are locked until their
;                      processes exit, so they are deleted at the next reboot
; There is no user-data switch: this process runs elevated, so its $APPDATA and
; $LOCALAPPDATA belong to the account that approved UAC, which is not the invoking
; user's when a standard user typed an administrator's password. The branded
; uninstaller removes the invoking user's data itself, unelevated.

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

    ${If} $SluiDeleteUserData = 1
      ; What the template does for the check box besides the data folders.
      DeleteRegKey SHCTX "${MANUPRODUCTKEY}"
      DeleteRegKey /ifempty SHCTX "${MANUKEY}"
      DeleteRegValue HKCU "${MANUPRODUCTKEY}" "Installer Language"
      DeleteRegKey /ifempty HKCU "${MANUPRODUCTKEY}"
      DeleteRegKey /ifempty HKCU "${MANUKEY}"
      ; RunAsUser starts the command through the desktop shell, unelevated, so %APPDATA%
      ; and %LOCALAPPDATA% are the invoking user's. The pause lets SLUI's WebView2
      ; processes, closed by the template, release the data folder.
      nsis_tauri_utils::RunAsUser "$SYSDIR\cmd.exe" '/d /c ping -n 3 127.0.0.1 >nul & rd /s /q "%APPDATA%\${BUNDLEID}" & rd /s /q "%LOCALAPPDATA%\${BUNDLEID}"'
    ${EndIf}

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
