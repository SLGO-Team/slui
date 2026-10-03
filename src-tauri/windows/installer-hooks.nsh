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
; Without /NS (plain NSIS runs, a future updater) this hook does nothing.
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
!macroend
