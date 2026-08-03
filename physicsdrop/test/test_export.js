/**
 * Tests for export.js.
 *
 * Only the path logic is testable headlessly — the frame loop needs a document. That is fine,
 * because the path logic is where the interesting decision lives: `/fs` is denied in the sandbox,
 * so the output folder cannot be created and the exporter has to degrade to writing flat rather
 * than failing outright, the way v1.1 would.
 */

'use strict';

module.exports = function (PD, h) {

  h.group('export: timestamp');

  var s = PD.exportStamp();
  h.assert('the stamp is YYYYMMDD_HHMMSS', /^\d{8}_\d{6}$/.test(s), s);
  h.assert('and is zero padded to a fixed width', s.length === 15, s + ' (' + s.length + ')');

  h.group('export: where files go');

  // require('/fs') throws outside Affinity, which is exactly the denied case: no folder can be
  // made, so the exporter must fall back rather than give up.
  var mockApp = { userDesktopPath: 'E:\\USER\\Desktop' };
  var flat = PD.exportResolveTarget(mockApp, 'png');

  h.assert('a target is still produced when no folder can be made', !flat.error, String(flat.error));
  h.assertEqual('and it is the flat fallback', flat.folder, false);
  h.assert('files land on the Desktop', flat.path(0).indexOf('E:\\USER\\Desktop') === 0, flat.path(0));
  h.assert('with the requested extension', /\.png$/.test(flat.path(0)), flat.path(0));

  // Frame numbers must zero-pad, or an image sequence sorts 1, 10, 11, 2 and imports scrambled.
  h.assert('frame numbers are zero padded to 4', /_0000\.png$/.test(flat.path(0)), flat.path(0));
  h.assert('and stay padded past nine', /_0042\.png$/.test(flat.path(42)), flat.path(42));
  h.assert('and do not overflow at four digits', /_1234\.png$/.test(flat.path(1234)), flat.path(1234));

  // Every frame of one run must share a prefix, since they are not in a folder of their own.
  var a = flat.path(0), b = flat.path(1);
  var prefixA = a.slice(0, a.lastIndexOf('_'));
  var prefixB = b.slice(0, b.lastIndexOf('_'));
  h.assertEqual('all frames of a run share one prefix', prefixA, prefixB);

  h.assert('jpeg gets the jpg extension',
    /\.jpg$/.test(PD.exportResolveTarget(mockApp, 'jpg').path(0)));

  h.group('export: failure reporting');

  h.assert('no Desktop path is reported rather than thrown',
    !!PD.exportResolveTarget({}, 'png').error);
  h.assert('an app that throws is reported too',
    !!PD.exportResolveTarget({ get userDesktopPath() { throw new Error('denied'); } }, 'png').error);

  // A missing SDK must call back with a failure, not throw: the export runs on a timer, and an
  // exception there would leave the timer wedged.
  var reported = null;
  PD.exportSequence({ doc: null, lastIndex: 3 }, {}, function (res) { reported = res; });
  h.assert('a missing SDK calls back', reported !== null);
  h.assertEqual('with a failure', reported.ok, false);
  h.assert('and an explanation', typeof reported.error === 'string' && reported.error.length > 0,
    String(reported && reported.error));
};
